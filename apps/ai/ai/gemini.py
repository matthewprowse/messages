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
import time
import wave
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from . import log
from .analytics import Analytics, event, prompt_id
from .http import POOL
from .pricing import cost_usd
from .supabase import Supabase

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
EMBED_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:batchEmbedContents"
MODEL_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}"
UPLOAD_ENDPOINT = "https://generativelanguage.googleapis.com/upload/v1beta/files"
FILE_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/{name}"  # name is "files/<id>"
FILE_READY_S = 300  # a long recording can take a minute or two to be processed after upload
EMBED_DIMENSIONS = 768  # matches messages.embedding
RETRY_STATUSES = {429, 500, 502, 503, 504}
MAX_RETRY_WAIT_S = 60  # a longer wait asked for (a daily quota) is not waited out here


class GeminiError(Exception):
    def __init__(self, status: int | None, reason: str, detail: str = ""):
        super().__init__(f"gemini failed ({status}): {reason}")
        self.status = status
        self.detail = detail  # Google's message about the request, for telling error kinds apart; not logged


@dataclass(frozen=True)
class UsageContext:
    """Who a call was for, so its cost is filed against the right person and account."""

    user_id: str
    feature: str  # triage, draft, learn (learning includes embeddings and summaries), brief or transcribe
    account_id: str | None = None
    thread_id: str | None = None


@dataclass(frozen=True)
class Usage:
    input_tokens: int
    cached_tokens: int
    output_tokens: int
    cost_usd: float


def read_usage(model: str, metadata: dict[str, Any], on: datetime) -> Usage:
    prompt = int(metadata.get("promptTokenCount") or 0)
    cached = int(metadata.get("cachedContentTokenCount") or 0)
    output = int(metadata.get("candidatesTokenCount") or 0) + int(metadata.get("thoughtsTokenCount") or 0)
    return Usage(prompt, cached, output, round(cost_usd(model, on.date(), prompt, cached, output), 6))


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
        file: tuple[str, str] | None = None,
    ) -> dict[str, Any]:
        """system goes first and should be the same text on every call of a kind, and prompt should put
        what changes least first: Gemini bills a repeated start of a request at the cached rate.
        max_output caps output and thinking tokens together, against a reply that runs away; keep it
        generous, as a reply cut short is not JSON. thinking "minimal" falls back to "low" on a model
        that does not offer it. audio is sent inline (up to about 20MB); file is (uri, mime type) of one
        sent ahead with upload_file, for a recording too long to send inline."""
        if thinking == "minimal" and model in self._no_minimal:
            thinking = "low"
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
        if file:
            parts.append({"fileData": {"fileUri": file[0], "mimeType": file[1]}})
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": config,
        }
        started = time.monotonic()
        stats = {"attempts": 0}
        code = prompt_id(system)
        try:
            data = self._call(model, body, attempts=attempts, timeout=timeout, stats=stats)
        except GeminiError as err:
            if not (thinking == "minimal" and err.status == 400 and "thinking" in err.detail.lower()):
                self._failed(model, usage, code, started, stats, err)
                raise
            self._no_minimal.add(model)
            log.warn("thinking level minimal not offered, using low", model=model)
            config["thinkingConfig"] = {"thinkingLevel": "low"}
            try:
                data = self._call(model, body, attempts=attempts, timeout=timeout, stats=stats)
            except GeminiError as again:
                self._failed(model, usage, code, started, stats, again)
                raise
        when = datetime.now(timezone.utc)
        used = read_usage(model, data.get("usageMetadata") or {}, when)
        self._record(model, usage, used)

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
        started = time.monotonic()
        stats = {"attempts": 0}
        try:
            data = self._call(model, body, timeout=timeout, stats=stats)
        except GeminiError as err:
            self._failed(model, usage, "speech", started, stats, err)
            raise
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

    def _record(self, model: str, ctx: UsageContext, usage: Usage) -> None:
        self._usage.submit(self._insert_usage, model, ctx, usage)

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
            self._db.insert(
                "ai_usage",
                {
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
                },
            )
        except Exception as err:  # never lose the answer over bookkeeping
            log.warn("usage not recorded", code=log.code_of(err))
