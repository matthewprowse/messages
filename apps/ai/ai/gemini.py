"""Gemini over its REST API, with JSON output. Every call records its tokens and cost in ai_usage.

Calls go over a kept-alive connection. A call that fails for a passing reason (rate limit, overload, a
dropped connection) is tried again, after the wait Gemini asks for when it gives one; one it will not
answer soon (a quota that resets in more than a minute) fails at once, so the caller's own back-off
takes over instead of holding the worker. Usage rows are written in the background, so a draft is not
kept waiting on bookkeeping. Each call also leaves a content-free analytics event (ai_call: feature, model,
prompt code, time taken, tokens, cost, tries), for finding slow, failing or costly calls."""

from __future__ import annotations

import base64
import http.client
import json
import random
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

from . import log
from .analytics import Analytics, event, prompt_id
from .billing import Breaker, is_billing_error, persist_to
from .gemini_batch import BatchMixin
from .gemini_budget import BudgetMixin
from .gemini_estimate import (  # noqa: F401  re-exported: other modules and tests import these from here
    error_reason,
    estimate_cost,
    estimate_input_tokens,
    modality_tokens,
    normalise,
    pcm_to_wav,
    price_in,
    read_usage,
    retry_wait,
)
from .gemini_files import FilesMixin
from .gemini_types import (  # noqa: F401  re-exported: other modules and tests import these from here
    AUDIO_ATTEMPTS,
    AUDIO_BYTES_PER_SECOND,
    BATCH_DISCOUNT,
    BATCH_ENDPOINT,
    BUDGET_CHECK_S,
    BUDGET_EXEMPT,
    CACHE_ENDPOINT,
    DEFAULT_LIMITS,
    DEFAULT_OUTPUT_ESTIMATE,
    EMBED_DIMENSIONS,
    EMBED_ENDPOINT,
    ENDPOINT,
    FILE_ENDPOINT,
    FILE_READY_S,
    MAX_RETRY_WAIT_S,
    MODEL_ENDPOINT,
    OPERATION_ENDPOINT,
    RETRY_STATUSES,
    SETUP_FEATURES,
    UPLOAD_ENDPOINT,
    GeminiError,
    Hold,
    Usage,
    UsageContext,
    guarded,
)
from .http import POOL
from .pricing import SEARCH_QUERY_USD, cost_usd
from .supabase import Supabase


class Gemini(BudgetMixin, FilesMixin, BatchMixin):
    def __init__(self, api_key: str, db: Supabase):
        self._key = api_key
        self._db = db
        self._usage = ThreadPoolExecutor(max_workers=1, thread_name_prefix="usage")  # finishes its queue on exit
        self._events = Analytics(db)
        self._breaker = Breaker(on_change=persist_to(db))  # trips on a billing failure so calls stop at once instead of failing one by one
        self._no_minimal: set[str] = set()  # models that turned down thinkingLevel "minimal"
        self._lock = threading.Lock()
        # user -> (read at, month % per feature, week % per feature, month dollars per feature, week dollars per feature)
        self._budgets: dict[str, tuple[float, dict[str, float], dict[str, float], dict[str, float], dict[str, float]]] = {}
        self._reserved: dict[tuple[str, str], float] = {}  # (user, feature) -> dollars held for calls in flight
        self._spent: dict[tuple[str, str], float] = {}  # (user, feature) -> dollars used since the allowance was last read
        self._limits: tuple[float, dict[str, int]] | None = None
        self._setups: dict[str, list[float]] = {}  # user -> [read at, setup dollars left]
        self._caches: dict[str, tuple[str, UsageContext, int, float, int]] = {}  # cache name -> (model, who, tokens, made at, ttl) until its storage is recorded


    def billing_blocked(self) -> bool:
        """True while the billing breaker would refuse a call. Checked before a download or an upload so a paused
        account does not repeat that work every poll for a call that cannot be made."""
        return self._breaker.blocked()

    def _flush_usage(self) -> None:
        try:
            self._usage.submit(lambda: None).result(timeout=5)
        except Exception:
            pass

    def close(self) -> None:
        """Writes the usage rows still queued. Called on shutdown, so no call is billed and not counted."""
        self._usage.shutdown(wait=True)

    def json(
        self,
        model: str,
        system: str,
        prompt: str,
        schema: dict[str, Any],
        usage: UsageContext,
        *,
        temperature: float = 0.2,
        thinking: str = "low",
        max_output: int | None = None,
        attempts: int = 4,
        timeout: float = 90,
        audio: tuple[bytes, str] | None = None,
        image: tuple[bytes, str] | None = None,
        file: tuple[str, str] | None = None,
        spent: list[Usage] | None = None,
        hold: Hold | None = None,
        cached: str | None = None,
        audio_seconds: float | None = None,
    ) -> dict[str, Any]:
        """system goes first and should be the same text on every call of a kind, and prompt should put
        what changes least first: Gemini bills a repeated start of a request at the cached rate.
        max_output caps output and thinking tokens together, against a reply that runs away; keep it
        generous, as a reply cut short is not JSON. thinking "minimal" falls back to "low" on a model
        that does not offer it. audio is sent inline (up to about 20MB); file is (uri, mime type) of one
        sent ahead with upload_file, for a recording too long to send inline. image is (bytes, mime type),
        sent inline. The call's usage is added to spent when given, for a caller that keeps its own tally.
        The call's estimated cost is held against the person's share while it runs (see _check_budget); hold is a
        job's reservation made ahead (Gemini.hold), in which case the call is not checked again. cached is the name
        of a cache made with cache_file, which carries the system text and the file: neither is sent again, and its
        tokens are billed at the cached rate. audio_seconds is the length of a file, for the estimate."""
        if thinking == "minimal" and model in self._no_minimal:
            thinking = "low"
        if audio and attempts > AUDIO_ATTEMPTS:
            attempts = AUDIO_ATTEMPTS  # a timed out call may still be billed, and audio input is dear
        config: dict[str, Any] = {
            "responseMimeType": "application/json",
            "responseJsonSchema": schema,
            "temperature": temperature,
            "thinkingConfig": {"thinkingLevel": thinking},
        }
        if max_output:
            config["maxOutputTokens"] = max_output
        parts: list[dict[str, Any]] = [{"text": prompt}]
        if audio:  # (bytes, mime type): a recording sent with the prompt, such as a voice note to transcribe
            parts.append({"inlineData": {"mimeType": audio[1], "data": base64.b64encode(audio[0]).decode("ascii")}})
        if image:
            parts.append({"inlineData": {"mimeType": image[1], "data": base64.b64encode(image[0]).decode("ascii")}})
        if file and not cached:
            parts.append({"fileData": {"fileUri": file[0], "mimeType": file[1]}})
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": config,
        }
        if cached:  # the system text and the file are in the cache; a request that sets them again is refused
            del body["systemInstruction"]
            body["cachedContent"] = cached
        if hold is not None:
            held = 0.0
        else:
            # A cached file is read at the cached rate, so only the text sent is estimated for the call itself.
            held = self._check_budget(usage, estimate_cost(model, body, max_output, None if cached else audio_seconds))
        try:
            return self._send_json(model, body, config, thinking, usage, system, attempts, timeout, spent)
        finally:
            self._release(usage, held)

    def _send_json(
        self, model: str, body: dict[str, Any], config: dict[str, Any], thinking: str, usage: UsageContext, system: str, attempts: int, timeout: float, spent: list[Usage] | None
    ) -> dict[str, Any]:
        started = time.monotonic()
        stats = {"attempts": 0}
        code = prompt_id(system)
        try:
            data = self._call(model, body, attempts=attempts, timeout=timeout, stats=stats)
        except GeminiError as err:
            if not (thinking == "minimal" and err.status == 400 and "thinking" in err.detail.lower()):
                self._lost(model, usage, body, stats)
                self._failed(model, usage, code, started, stats, err)
                raise
            self._no_minimal.add(model)
            log.warn("thinking level minimal not offered, using low", model=model)
            config["thinkingConfig"] = {"thinkingLevel": "low"}
            try:
                data = self._call(model, body, attempts=attempts, timeout=timeout, stats=stats)
            except GeminiError as again:
                self._lost(model, usage, body, stats)
                self._failed(model, usage, code, started, stats, again)
                raise
        self._lost(model, usage, body, stats)
        when = datetime.now(timezone.utc)
        used = read_usage(model, data.get("usageMetadata") or {}, when)
        self._record(model, usage, used)
        if spent is not None:
            spent.append(used)

        candidates = data.get("candidates") or []
        if not candidates:
            self._failed(model, usage, code, started, stats, None, "empty", used)
            raise GeminiError(None, "no candidates (blocked or empty)")
        parts = candidates[0].get("content", {}).get("parts") or []
        text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
        try:
            answer = json.loads(text)
        except ValueError:
            if candidates[0].get("finishReason") == "MAX_TOKENS":  # cut short, not malformed: max_output was too small for this input
                self._failed(model, usage, code, started, stats, None, "truncated", used)
                raise GeminiError(None, "response was cut short (max tokens)") from None
            self._failed(model, usage, code, started, stats, None, "not_json", used)
            raise GeminiError(None, "response was not JSON") from None
        self._emit(model, usage, code, started, stats, used)
        return answer

    def search(
        self, model: str, system: str, prompt: str, usage: UsageContext, *, thinking: str = "low", timeout: float = 120, spent: list[Usage] | None = None
    ) -> tuple[str, list[str]]:
        """A text answer grounded with Google Search, and the addresses of the pages it drew on. Each search
        query Google runs is billed on top of the tokens (pricing.SEARCH_QUERY_USD), and counted in the cost
        recorded. Structured output is not asked for: with it, the model was seen to answer without searching."""
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "tools": [{"google_search": {}}],
            "generationConfig": {"temperature": 0.2, "thinkingConfig": {"thinkingLevel": thinking}},
        }
        held = self._check_budget(usage, estimate_cost(model, body, None) + 3 * SEARCH_QUERY_USD)
        try:
            return self._search(model, body, system, usage, timeout, spent)
        finally:
            self._release(usage, held)

    def _search(self, model: str, body: dict[str, Any], system: str, usage: UsageContext, timeout: float, spent: list[Usage] | None) -> tuple[str, list[str]]:
        started = time.monotonic()
        stats = {"attempts": 0}
        code = prompt_id(system)
        try:
            data = self._call(model, body, timeout=timeout, stats=stats)
        except GeminiError as err:
            self._lost(model, usage, body, stats)
            self._failed(model, usage, code, started, stats, err)
            raise
        self._lost(model, usage, body, stats)
        candidate = (data.get("candidates") or [{}])[0]
        grounding = candidate.get("groundingMetadata") or {}
        queries = len(grounding.get("webSearchQueries") or [])
        used = read_usage(model, data.get("usageMetadata") or {}, datetime.now(timezone.utc))
        used = Usage(used.input_tokens, used.cached_tokens, used.output_tokens, round(used.cost_usd + queries * SEARCH_QUERY_USD, 6))
        self._record(model, usage, used)
        if spent is not None:
            spent.append(used)
        parts = (candidate.get("content") or {}).get("parts") or []
        text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
        if not text:
            self._failed(model, usage, code, started, stats, None, "empty", used)
            raise GeminiError(None, "no answer (blocked or empty)")
        self._emit(model, usage, code, started, stats, used)
        pages = [str((c.get("web") or {}).get("uri") or "") for c in grounding.get("groundingChunks") or []]
        return text, [p for p in pages if p.startswith("https://")]

    def speak(self, model: str, text: str, voice: str, usage: UsageContext, *, timeout: float = 180) -> bytes:
        """text read aloud by a speech model, as a WAV file. Raw PCM (audio/L16) is wrapped in a WAV
        header, as older speech models return that instead."""
        body = {
            "contents": [{"role": "user", "parts": [{"text": text}]}],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}},
            },
        }
        # About 25 audio tokens a second, at most a few minutes of speech for a part of the brief.
        held = self._check_budget(usage, estimate_cost(model, body, 25 * 240))
        try:
            return self._speak(model, body, usage, timeout)
        finally:
            self._release(usage, held)

    def _speak(self, model: str, body: dict[str, Any], usage: UsageContext, timeout: float) -> bytes:
        started = time.monotonic()
        stats = {"attempts": 0}
        try:
            data = self._call(model, body, timeout=timeout, stats=stats)
        except GeminiError as err:
            self._lost(model, usage, body, stats)
            self._failed(model, usage, "speech", started, stats, err)
            raise
        self._lost(model, usage, body, stats)
        used = read_usage(model, data.get("usageMetadata") or {}, datetime.now(timezone.utc))
        self._record(model, usage, used)
        parts = ((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
        inline = next((p["inlineData"] for p in parts if isinstance(p.get("inlineData"), dict)), None)
        if not inline or not inline.get("data"):
            self._failed(model, usage, "speech", started, stats, None, "empty", used)
            raise GeminiError(None, "no audio (blocked or empty)")
        self._emit(model, usage, "speech", started, stats, used)
        audio = base64.b64decode(inline["data"])
        mime = str(inline.get("mimeType") or "")
        if "wav" in mime:
            return audio
        rate = re.search(r"rate=(\d+)", mime)
        return pcm_to_wav(audio, int(rate.group(1)) if rate else 24000)

    def embed(self, model: str, texts: list[str], usage: UsageContext) -> list[list[float]]:
        """One vector per text, EMBED_DIMENSIONS long, in the same order. gemini-embedding-2 renormalises
        shortened vectors itself; they are normalised here too, so cosine distance is safe either way."""
        if not texts:
            return []
        body = {
            "requests": [
                {"model": f"models/{model}", "content": {"parts": [{"text": t}]}, "outputDimensionality": EMBED_DIMENSIONS}
                for t in texts
            ]
        }
        held = self._check_budget(usage, sum(len(t) for t in texts) // 3 * price_in(model) / 1_000_000)
        try:
            return self._embed(model, texts, body, usage)
        finally:
            self._release(usage, held)

    def _embed(self, model: str, texts: list[str], body: dict[str, Any], usage: UsageContext) -> list[list[float]]:
        started = time.monotonic()
        stats = {"attempts": 0}
        try:
            data = self._call(model, body, EMBED_ENDPOINT, stats=stats)
        except GeminiError as err:
            self._failed(model, usage, "embedding", started, stats, err)
            raise
        when = datetime.now(timezone.utc)
        metadata = data.get("usageMetadata") or {}
        if not metadata.get("promptTokenCount"):
            # The embedding API may not report tokens; about four characters a token is close for email text.
            metadata = {"promptTokenCount": sum(len(t) for t in texts) // 4 + len(texts)}
        used = read_usage(model, metadata, when)
        self._record(model, usage, used)
        self._emit(model, usage, "embedding", started, stats, used)

        vectors = [normalise(e.get("values") or []) for e in data.get("embeddings") or []]
        if len(vectors) != len(texts) or any(len(v) != EMBED_DIMENSIONS for v in vectors):
            raise GeminiError(None, "embeddings missing or the wrong size")
        return vectors

    def _failure(self, status: int | None, reason: str, detail: str = "") -> GeminiError:
        """The error for a failed response. A billing failure trips the breaker (one warning, however many calls
        see it) and is reported as billing_paused, so callers treat it like a paused budget, not a try."""
        if not is_billing_error(status, reason, detail):
            return GeminiError(status, reason, detail)
        if self._breaker.trip():
            log.warn("gemini billing failed, calls paused", code=status, minutes=int(self._breaker._window // 60))
        return GeminiError(status, "billing_paused", detail)


    def warm(self, model: str) -> None:
        """Opens (or refreshes) a pooled connection to Gemini ahead of a call, so the call does not wait for
        a TLS handshake: about 0.6s on a draft, measured. Reads only the model's description, so it costs
        no tokens. Failures are ignored; the call opens its own connection."""
        try:
            POOL.request("GET", MODEL_ENDPOINT.format(model=model), None, {"x-goog-api-key": self._key}, timeout=10)
        except Exception:
            pass

    @guarded
    def _call(
        self, model: str, body: dict[str, Any], endpoint: str = ENDPOINT, *, attempts: int = 4, timeout: float = 90, stats: dict[str, int] | None = None
    ) -> dict[str, Any]:
        payload = json.dumps(body).encode()
        headers = {"Content-Type": "application/json", "x-goog-api-key": self._key}
        for attempt in range(attempts):
            if stats is not None:
                stats["attempts"] += 1
            last = attempt == attempts - 1
            wait = min(30.0, 2**attempt + random.random())
            try:
                res = POOL.request("POST", endpoint.format(model=model), payload, headers, timeout=timeout)
            except (OSError, http.client.HTTPException) as err:  # timeouts and dropped connections
                if stats is not None:
                    stats["lost"] = stats.get("lost", 0) + 1  # sent and not answered: Gemini may still bill the input
                if last:
                    raise GeminiError(None, type(err).__name__) from None
            else:
                if res.status < 300:
                    try:
                        return json.loads(res.body)
                    except ValueError:
                        raise GeminiError(res.status, "response was not JSON") from None
                reason, detail = error_reason(res.body)
                asked = retry_wait(res.body, res.headers)
                if is_billing_error(res.status, reason, detail) or res.status not in RETRY_STATUSES or last or (asked or 0) > MAX_RETRY_WAIT_S:  # billing is never waited out
                    raise self._failure(res.status, reason, detail)
                if asked is not None:
                    wait = asked + random.random()
            time.sleep(wait)
        raise GeminiError(None, "retries exhausted")

    def _lost(self, model: str, ctx: UsageContext, body: dict[str, Any], stats: dict[str, int]) -> None:
        """Records an estimate for each attempt that was sent and never answered (a timeout or a dropped
        connection): Gemini can bill its input, and without this such a call is billed and not counted. The
        estimate is the input only, since what was written is unknown."""
        lost = stats.pop("lost", 0) if stats else 0
        if not lost:
            return
        text, audio = estimate_input_tokens(body)
        now = datetime.now(timezone.utc)
        cost = cost_usd(model, now.date(), text + audio, 0, 0, audio)
        for _ in range(lost):
            self._record(model, ctx, Usage(text + audio, 0, 0, round(cost, 6)))

    def _record(self, model: str, ctx: UsageContext, usage: Usage) -> None:
        if ctx.feature not in BUDGET_EXEMPT and not (ctx.feature in SETUP_FEATURES and (self._setups.get(ctx.user_id) or [0, 0.0])[1] > 0):
            with self._lock:  # counted at once, so a call made before the row is written already sees it
                key = (ctx.user_id, ctx.feature)
                self._spent[key] = self._spent.get(key, 0.0) + usage.cost_usd
        try:
            self._usage.submit(self._insert_usage, model, ctx, usage)
        except RuntimeError:  # closed at shutdown while a late thread was still finishing a call: write it here
            self._insert_usage(model, ctx, usage)

    def _emit(
        self, model: str, ctx: UsageContext, prompt: str, started: float, stats: dict[str, int], used: Usage | None, *, ok: bool = True, code: str | None = None
    ) -> None:
        cached = round(100 * used.cached_tokens / used.input_tokens) if used and used.input_tokens else 0
        self._events.emit(
            ctx.user_id,
            [
                event(
                    "ai_call",
                    feature=ctx.feature,
                    model=model,
                    prompt=prompt,
                    ms=round((time.monotonic() - started) * 1000),
                    ok=ok,
                    code=code,
                    in_tok=used.input_tokens if used else 0,
                    out_tok=used.output_tokens if used else 0,
                    cached_pct=cached,
                    cost_micro=round(used.cost_usd * 1_000_000) if used else 0,
                    attempts=stats["attempts"],
                )
            ],
        )

    def _failed(
        self, model: str, ctx: UsageContext, prompt: str, started: float, stats: dict[str, int], err: GeminiError | None, code: str | None = None, used: Usage | None = None
    ) -> None:
        if code is None:
            code = f"http_{err.status}" if err is not None and err.status else "no_response"
        self._emit(model, ctx, prompt, started, stats, used, ok=False, code=code)

    def _insert_usage(self, model: str, ctx: UsageContext, usage: Usage) -> None:
        try:
            setup = ctx.feature in SETUP_FEATURES and self._setup_left(ctx.user_id) > 0
            if setup:
                self._setups[ctx.user_id][1] -= usage.cost_usd
        except Exception as err:
            log.warn("setup allowance not read", code=log.code_of(err))
            setup = False
        row = {
            "user_id": ctx.user_id,
            "account_id": ctx.account_id,
            "thread_id": ctx.thread_id,
            "feature": ctx.feature,
            "provider": "gemini",
            "model": model,
            "input_tokens": usage.input_tokens,
            "cached_tokens": usage.cached_tokens,
            "output_tokens": usage.output_tokens,
            "cost_usd": usage.cost_usd,
            "setup": setup,
        }
        for attempt in range(3):  # a row lost is spend nobody counts, so a failed write is tried again
            try:
                self._db.insert("ai_usage", row)
                return
            except Exception as err:  # never lose the answer over bookkeeping
                log.warn("usage not recorded", code=log.code_of(err), attempt=attempt + 1)
                if attempt < 2:
                    time.sleep(1 + attempt)