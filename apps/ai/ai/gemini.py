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
import io
import json
import random
import re
import threading
import time
import wave
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from . import log
from .analytics import Analytics, event, prompt_id
from .http import POOL
from .pricing import AUDIO_TOKENS_PER_SECOND, SEARCH_QUERY_USD, cost_usd, price_or_fallback
from .supabase import Supabase

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
EMBED_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:batchEmbedContents"
MODEL_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}"
UPLOAD_ENDPOINT = "https://generativelanguage.googleapis.com/upload/v1beta/files"
FILE_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/{name}"  # name is "files/<id>"
CACHE_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/cachedContents"
BATCH_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:batchGenerateContent"
OPERATION_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/{name}"  # name is "batches/<id>"
FILE_READY_S = 300  # a long recording can take a minute or two to be processed after upload
EMBED_DIMENSIONS = 768  # matches messages.embedding
RETRY_STATUSES = {429, 500, 502, 503, 504}
MAX_RETRY_WAIT_S = 60  # a longer wait asked for (a daily quota) is not waited out here
AUDIO_ATTEMPTS = 2  # most tries a call with audio gets: a lost call can still bill the whole file


class GeminiError(Exception):
    def __init__(self, status: int | None, reason: str, detail: str = ""):
        super().__init__(f"gemini failed ({status}): {reason}")
        self.status = status
        self.detail = detail  # Google's message about the request, for telling error kinds apart; not logged


@dataclass(frozen=True)
class UsageContext:
    """Who a call was for, so its cost is filed against the right person and account."""

    user_id: str
    feature: str  # triage, draft, learn (learning includes embeddings and summaries), brief, transcribe or logos
    account_id: str | None = None
    thread_id: str | None = None


BUDGET_CHECK_S = 60  # how long a person's share of the monthly AI budget is trusted before it is read again
BUDGET_EXEMPT = {"logos"}  # shared by everyone and filed against the owner, so not one person's share
# What the admin panel can set besides the budget (ai_budget). Used until the real values are read.
DEFAULT_LIMITS = {"regen_per_hour": 10, "auto_drafts_per_day": 3, "summaries_per_day": 50}
BATCH_DISCOUNT = 0.5  # the Batch API bills half the standard price
DEFAULT_OUTPUT_ESTIMATE = 4096  # tokens a call is assumed to write, for reserving its cost, when it sets no maximum
AUDIO_BYTES_PER_SECOND = 16_000  # 128 kbit/s: a high guess for compressed audio, so the reserved cost errs high
SETUP_FEATURES = {"triage", "learn"}  # the first sort, search index and learning of a newly connected account


@dataclass(frozen=True)
class Usage:
    input_tokens: int
    cached_tokens: int
    output_tokens: int
    cost_usd: float


class Hold:
    """Dollars reserved for a job against a person's share (Gemini.hold). top_up asks for more, checked the same way."""

    def __init__(self, gemini: "Gemini", ctx: UsageContext, amount: float):
        self.gemini = gemini
        self.ctx = ctx
        self.amount = amount

    def top_up(self, more: float) -> None:
        self.amount += self.gemini._check_budget(self.ctx, more, strict=True)


def modality_tokens(details: Any, modality: str) -> int:
    """Tokens of one modality ("AUDIO") from a promptTokensDetails or cacheTokensDetails list."""
    total = 0
    for d in details if isinstance(details, list) else []:
        if isinstance(d, dict) and str(d.get("modality") or "").upper() == modality:
            total += int(d.get("tokenCount") or 0)
    return total


def read_usage(model: str, metadata: dict[str, Any], on: datetime) -> Usage:
    prompt = int(metadata.get("promptTokenCount") or 0)
    cached = int(metadata.get("cachedContentTokenCount") or 0)
    output = int(metadata.get("candidatesTokenCount") or 0) + int(metadata.get("thoughtsTokenCount") or 0)
    audio = modality_tokens(metadata.get("promptTokensDetails"), "AUDIO")
    cached_audio = modality_tokens(metadata.get("cacheTokensDetails"), "AUDIO")
    return Usage(prompt, cached, output, round(cost_usd(model, on.date(), prompt, cached, output, audio, cached_audio), 6))


def estimate_input_tokens(body: dict[str, Any], audio_seconds: float | None = None) -> tuple[int, int]:
    """(text tokens, audio tokens) a request is likely to use, from its size. Text is about 4 characters a
    token (3 here, to err high); inline audio is guessed from its bytes unless the length is known."""
    text, audio_bytes = 0, 0
    system = (body.get("systemInstruction") or {}).get("parts") or []
    for content in [{"parts": system}, *(body.get("contents") or [])]:
        for part in content.get("parts") or []:
            if "text" in part:
                text += len(str(part["text"]))
            inline = part.get("inlineData")
            if isinstance(inline, dict):
                size = len(str(inline.get("data") or "")) * 3 // 4
                if str(inline.get("mimeType") or "").startswith("audio"):
                    audio_bytes += size
                else:
                    text += 3000  # an image is a few hundred to a thousand tokens
    audio = int(audio_seconds * AUDIO_TOKENS_PER_SECOND) if audio_seconds else audio_bytes * AUDIO_TOKENS_PER_SECOND // AUDIO_BYTES_PER_SECOND
    return text // 3 + 1, audio


def price_in(model: str) -> float:
    return price_or_fallback(model, datetime.now(timezone.utc).date()).input


def estimate_cost(model: str, body: dict[str, Any], max_output: int | None, audio_seconds: float | None = None) -> float:
    """The most a call is likely to cost, reserved before it is made: its input as estimated and the whole
    output allowance written. A model with no price is estimated at the dearest known price, never zero."""
    text, audio = estimate_input_tokens(body, audio_seconds)
    return cost_usd(model, datetime.now(timezone.utc).date(), text + audio, 0, max_output or DEFAULT_OUTPUT_ESTIMATE, audio)


def retry_wait(body: bytes, headers: dict[str, str]) -> float | None:
    """The wait Gemini asks for: RetryInfo.retryDelay ("37s") in the error, or a Retry-After header."""
    try:
        details = json.loads(body or b"{}").get("error", {}).get("details") or []
    except (ValueError, AttributeError):
        details = []
    for d in details:
        match = re.fullmatch(r"([0-9.]+)s", str(d.get("retryDelay") or "")) if isinstance(d, dict) else None
        if match:
            return float(match.group(1))
    after = headers.get("retry-after") or ""
    return float(after) if after.replace(".", "", 1).isdigit() else None


def error_reason(body: bytes) -> tuple[str, str]:
    """(status, message) from a Gemini error body. The message is Google's text about the request, never content."""
    try:
        error = json.loads(body or b"{}").get("error", {})
        return str(error.get("status") or "error"), str(error.get("message") or "")
    except (ValueError, AttributeError):
        return "error", ""


def pcm_to_wav(pcm: bytes, rate: int) -> bytes:
    """16-bit mono PCM as a WAV file."""
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return out.getvalue()


def normalise(values: list[float]) -> list[float]:
    norm = sum(v * v for v in values) ** 0.5
    return [v / norm for v in values] if norm else list(values)


class Gemini:
    def __init__(self, api_key: str, db: Supabase):
        self._key = api_key
        self._db = db
        self._usage = ThreadPoolExecutor(max_workers=1, thread_name_prefix="usage")  # finishes its queue on exit
        self._events = Analytics(db)
        self._no_minimal: set[str] = set()  # models that turned down thinkingLevel "minimal"
        self._lock = threading.Lock()
        # user -> (read at, month % per feature, week % per feature, month dollars per feature, week dollars per feature)
        self._budgets: dict[str, tuple[float, dict[str, float], dict[str, float], dict[str, float], dict[str, float]]] = {}
        self._reserved: dict[tuple[str, str], float] = {}  # (user, feature) -> dollars held for calls in flight
        self._spent: dict[tuple[str, str], float] = {}  # (user, feature) -> dollars used since the allowance was last read
        self._limits: tuple[float, dict[str, int]] | None = None
        self._setups: dict[str, list[float]] = {}  # user -> [read at, setup dollars left]

    def limits(self) -> dict[str, int]:
        """The per-conversation and per-day limits from ai_budget, read at most once a minute. If they cannot be
        read, the last ones read are used, or the defaults."""
        now = time.monotonic()
        if self._limits is None or now - self._limits[0] > BUDGET_CHECK_S:
            values = self._limits[1] if self._limits else dict(DEFAULT_LIMITS)
            try:
                row = self._db.first("ai_budget", {"select": ",".join(DEFAULT_LIMITS)})
                if row:
                    values = {k: int(row[k]) for k in DEFAULT_LIMITS if row.get(k) is not None}
            except Exception as err:
                log.warn("ai limits not read", code=log.code_of(err))
            self._limits = (now, {**DEFAULT_LIMITS, **values})
        return self._limits[1]

    def _setup_left(self, user_id: str) -> float:
        """Dollars left of the setup allowance for accounts connected recently (ai_budget.setup_usd each, for
        ai_budget.setup_days). Calls under it are not counted toward the week or the month. Zero when the
        allowance cannot be read."""
        now = time.monotonic()
        read = self._setups.get(user_id)
        if read is None or now - read[0] > BUDGET_CHECK_S:
            try:
                state = self._db.rpc("ai_setup_state", {"p_user": user_id}) or {}
                left = max(0.0, float(state.get("allowance") or 0) - float(state.get("spent") or 0))
            except Exception as err:
                log.warn("ai setup allowance not read", code=log.code_of(err))
                left = 0.0
            read = self._setups[user_id] = [now, left]
        return read[1]

    def _allowance(self, user_id: str) -> tuple[float, dict[str, float], dict[str, float], dict[str, float], dict[str, float]]:
        """The person's percent used per feature (month and week) and, when ai_allowance_shares_for exists, the
        dollars each share is worth, read at most once a minute. Raises GeminiError(budget_unknown) when the
        allowance cannot be read: the check fails closed, so no call is made without knowing the budget."""
        now = time.monotonic()
        read = self._budgets.get(user_id)
        if read is not None and now - read[0] <= BUDGET_CHECK_S:
            return read
        self._flush_usage()  # so spend not yet written is in what is read, and the tally since the read can start again
        try:
            state = self._db.rpc("ai_allowance_for", {"p_user": user_id})
            if not isinstance(state, dict):
                raise ValueError("no allowance")
            # A null percent is a feature whose share is zero (the SQL divides by nullif(share, 0)): used up, not unlimited.
            month = {k: 100.0 if v is None else float(v) for k, v in (state.get("features") or {}).items()}
            week = {k: 100.0 if v is None else float(v) for k, v in (state.get("week_features") or {}).items()}
        except Exception as err:
            log.warn("ai budget not read, call not made", code=log.code_of(err))
            raise GeminiError(None, "budget_unknown") from None
        usd: dict[str, float] = {}
        week_usd: dict[str, float] = {}
        if month:
            try:  # dollars per share; without them only the percentages are checked
                shares = self._db.rpc("ai_allowance_shares_for", {"p_user": user_id})
                if isinstance(shares, dict):
                    usd = {k: 0.0 if v is None else float(v) for k, v in (shares.get("features") or {}).items()}
                    week_usd = {k: 0.0 if v is None else float(v) for k, v in (shares.get("week_features") or {}).items()}
            except Exception as err:
                log.warn("ai share dollars not read", code=log.code_of(err))
        read = (now, month, week, usd, week_usd)
        with self._lock:
            self._budgets[user_id] = read
            for key in [k for k in self._spent if k[0] == user_id]:
                del self._spent[key]
        return read

    def _check_budget(self, ctx: UsageContext, estimate: float = 0.0, *, strict: bool = False) -> float:
        """Raises GeminiError(budget_paused) once the person has used their share of the monthly AI budget for
        this feature, or of its weekly limit (ai_budget, set in the admin panel; ai_allowance_for works the
        percentages out), and GeminiError(budget_unknown) when the budget cannot be read. Callers treat either
        like any failed call: a non-critical job skips it, sorting tries again later. Setup work goes ahead while
        the setup allowance lasts.

        Calls running at the same time cannot overshoot: the estimated cost (estimate, dollars) is held against the
        share until release, and counted with what was spent since the allowance was read, so the room left is what
        the share has over both. strict also refuses a call whose whole estimate does not fit, for a job that
        reserves its full cost up front (a meeting). Returns the dollars held, for release."""
        if ctx.feature in BUDGET_EXEMPT:
            return 0.0
        if ctx.feature in SETUP_FEATURES and self._setup_left(ctx.user_id) > 0:
            return 0.0
        _, month, week, usd, week_usd = self._allowance(ctx.user_id)
        if month.get(ctx.feature, 0.0) >= 100 or week.get(ctx.feature, 0.0) >= 100:
            raise GeminiError(None, "budget_paused")
        key = (ctx.user_id, ctx.feature)
        with self._lock:
            room = float("inf")
            if ctx.feature in usd:
                room = min(room, usd[ctx.feature] * (100 - month.get(ctx.feature, 0.0)) / 100)
            if ctx.feature in week_usd and ctx.feature in week:
                room = min(room, week_usd[ctx.feature] * (100 - week[ctx.feature]) / 100)
            room -= self._spent.get(key, 0.0) + self._reserved.get(key, 0.0)
            if room <= 0 or (strict and estimate > room):
                raise GeminiError(None, "budget_paused")
            self._reserved[key] = self._reserved.get(key, 0.0) + estimate
        return estimate

    def _release(self, ctx: UsageContext, held: float) -> None:
        if held:
            key = (ctx.user_id, ctx.feature)
            with self._lock:
                self._reserved[key] = max(0.0, self._reserved.get(key, 0.0) - held)

    @contextmanager
    def hold(self, ctx: UsageContext, estimate: float, *, strict: bool = True):
        """Reserves a whole job's estimated cost (a meeting's windows) before its first call, and holds it until the
        block ends. Calls inside pass hold=the yielded Hold so they are not checked again one by one. Raises
        budget_paused / budget_unknown at once when the share cannot cover it."""
        held = Hold(self, ctx, self._check_budget(ctx, estimate, strict=strict))
        try:
            yield held
        finally:
            self._release(ctx, held.amount)

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

    def upload_file(self, data: bytes, mime: str, *, timeout: float = 600) -> tuple[str, str]:
        """Sends a file to Gemini's Files API for calls that are too large to carry it inline, such as a
        meeting recording, and waits until it can be used. Returns (name, uri): uri goes in json(file=...),
        name in delete_file once done. Gemini keeps a file at most 48 hours; delete it sooner."""
        headers = {
            "x-goog-api-key": self._key,
            "Content-Type": "application/json",
            "X-Goog-Upload-Protocol": "resumable",
            "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": str(len(data)),
            "X-Goog-Upload-Header-Content-Type": mime,
        }
        try:
            # The display name is fixed: nothing about the file's content leaves here but its bytes.
            res = POOL.request("POST", UPLOAD_ENDPOINT, json.dumps({"file": {"display_name": "recording"}}).encode(), headers, timeout=60)
            url = res.headers.get("x-goog-upload-url")
            if res.status >= 300 or not url:
                raise GeminiError(res.status, error_reason(res.body)[0])
            sent = POOL.request(
                "POST",
                url,
                data,
                {"x-goog-api-key": self._key, "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize"},
                timeout=timeout,
            )
        except (OSError, http.client.HTTPException) as err:
            raise GeminiError(None, type(err).__name__) from None
        if sent.status >= 300:
            raise GeminiError(sent.status, error_reason(sent.body)[0])
        try:
            info = json.loads(sent.body).get("file") or {}
        except ValueError:
            raise GeminiError(sent.status, "response was not JSON") from None
        name, uri = str(info.get("name") or ""), str(info.get("uri") or "")
        if not name or not uri:
            raise GeminiError(sent.status, "no file in the response")
        deadline = time.monotonic() + FILE_READY_S
        state = str(info.get("state") or "")
        while state != "ACTIVE":
            if state == "FAILED" or time.monotonic() > deadline:
                self.delete_file(name)
                raise GeminiError(None, "file not processed")
            time.sleep(3)
            try:
                res = POOL.request("GET", FILE_ENDPOINT.format(name=name), None, {"x-goog-api-key": self._key}, timeout=30)
                state = str(json.loads(res.body).get("state") or "") if res.status < 300 else state
            except (OSError, http.client.HTTPException, ValueError):
                pass  # tried again until the deadline
        return name, uri

    def delete_file(self, name: str) -> None:
        """Removes a file sent with upload_file. Failures are ignored: Gemini drops it after 48 hours anyway."""
        try:
            POOL.request("DELETE", FILE_ENDPOINT.format(name=name), None, {"x-goog-api-key": self._key}, timeout=30)
        except Exception:
            pass

    def cache_file(self, model: str, system: str, file: tuple[str, str], usage: UsageContext, *, ttl_s: int = 1500) -> str | None:
        """Stores the system text and an uploaded file once as a cache (cachedContents), so several calls that
        ask about different parts of it (the windows of a long meeting) are billed for it once at full price and
        after that at the cached rate, instead of in full every time. Returns the cache's name for json(cached=...),
        or None when it could not be made (the caller then sends the file with every call). The cache is billed
        its tokens once, recorded here, and storage by the hour (not recorded; the ttl is kept short). Delete it
        with delete_cache when done."""
        body = {
            "model": f"models/{model}",
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"fileData": {"fileUri": file[0], "mimeType": file[1]}}]}],
            "ttl": f"{ttl_s}s",
        }
        try:
            data = self._call(model, body, CACHE_ENDPOINT, attempts=2, timeout=120, stats={"attempts": 0})
        except GeminiError as err:
            log.warn("context cache not made", status=err.status)
            return None
        name = str(data.get("name") or "")
        if not name:
            return None
        tokens = int((data.get("usageMetadata") or {}).get("totalTokenCount") or 0)
        if tokens:
            now = datetime.now(timezone.utc)
            self._record(model, usage, Usage(tokens, 0, 0, round(cost_usd(model, now.date(), tokens, 0, 0, tokens), 6)))
        return name

    def delete_cache(self, name: str) -> None:
        """Removes a cache made with cache_file. Failures are ignored: it expires on its own."""
        try:
            POOL.request("DELETE", FILE_ENDPOINT.format(name=name), None, {"x-goog-api-key": self._key}, timeout=30)
        except Exception:
            pass

    # -- Batch API: half price, answered within 24 hours, for work nobody is waiting on ------------------

    def batch_submit(self, model: str, items: list[tuple[str, dict[str, Any]]], *, name: str = "batch") -> str:
        """Sends many generateContent request bodies as one batch job and returns its name ("batches/..."). items
        are (key, body) with each body built as json() builds it. The jobs cost half; poll with batch_poll. Not
        checked against the allowance here: the caller reserves the job's estimate first (hold) and settles it
        with batch_settle."""
        body = {
            "batch": {
                "display_name": name[:60],
                "input_config": {"requests": {"requests": [{"request": b, "metadata": {"key": k}} for k, b in items]}},
            }
        }
        data = self._call(model, body, BATCH_ENDPOINT, attempts=3, timeout=300, stats={"attempts": 0})
        job = str(data.get("name") or "")
        if not job.startswith("batches/"):
            raise GeminiError(None, "no batch in the response")
        return job

    def batch_poll(self, job: str) -> tuple[str, dict[str, dict[str, Any]]]:
        """(state, answers). state is "running", "done", "failed" or "expired"; answers maps each request's key
        to its generateContent response (or {} for one that failed), and is filled only when done."""
        try:
            res = POOL.request("GET", OPERATION_ENDPOINT.format(name=job), None, {"x-goog-api-key": self._key}, timeout=60)
            data = json.loads(res.body) if res.status < 300 else {}
        except (OSError, http.client.HTTPException, ValueError):
            return "running", {}
        if res.status >= 300:
            return "running", {}
        state = str((data.get("metadata") or {}).get("state") or "")
        if "FAILED" in state or "CANCELLED" in state:
            return "failed", {}
        if "EXPIRED" in state:
            return "expired", {}
        if not data.get("done") and "SUCCEEDED" not in state:
            return "running", {}
        inlined = ((data.get("response") or {}).get("inlinedResponses") or {})
        rows = inlined.get("inlinedResponses") if isinstance(inlined, dict) else inlined
        out: dict[str, dict[str, Any]] = {}
        for row in rows or []:
            key = str(((row or {}).get("metadata") or {}).get("key") or "")
            if key:
                out[key] = row.get("response") or {}
        return "done", out

    def batch_settle(self, model: str, ctx: UsageContext, answer: dict[str, Any]) -> Usage:
        """Records a batch answer's usage at the batch price (half) and returns it."""
        used = read_usage(model, answer.get("usageMetadata") or {}, datetime.now(timezone.utc))
        used = Usage(used.input_tokens, used.cached_tokens, used.output_tokens, round(used.cost_usd * BATCH_DISCOUNT, 6))
        self._record(model, ctx, used)
        return used

    def warm(self, model: str) -> None:
        """Opens (or refreshes) a pooled connection to Gemini ahead of a call, so the call does not wait for
        a TLS handshake: about 0.6s on a draft, measured. Reads only the model's description, so it costs
        no tokens. Failures are ignored; the call opens its own connection."""
        try:
            POOL.request("GET", MODEL_ENDPOINT.format(model=model), None, {"x-goog-api-key": self._key}, timeout=10)
        except Exception:
            pass

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
                if res.status not in RETRY_STATUSES or last or (asked or 0) > MAX_RETRY_WAIT_S:
                    raise GeminiError(res.status, reason, detail)
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
