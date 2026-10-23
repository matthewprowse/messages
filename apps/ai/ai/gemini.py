"""Gemini over its REST API, with JSON output. Every call records its tokens and cost in ai_usage.

Calls go over a kept-alive connection. A call that fails for a passing reason (rate limit, overload, a
dropped connection) is tried again, after the wait Gemini asks for when it gives one; one it will not
answer soon (a quota that resets in more than a minute) fails at once, so the caller's own back-off
takes over instead of holding the worker. Usage rows are written in the background, so a draft is not
kept waiting on bookkeeping."""

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
from .http import POOL
from .pricing import cost_usd
from .supabase import Supabase

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
EMBED_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:batchEmbedContents"
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
    feature: str  # triage, draft, learn (learning includes embeddings and summaries) or brief
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
    ) -> dict[str, Any]:
        """system goes first and should be the same text on every call of a kind, and prompt should put
        what changes least first: Gemini bills a repeated start of a request at the cached rate.
        max_output caps output and thinking tokens together, against a reply that runs away; keep it
        generous, as a reply cut short is not JSON. thinking "minimal" falls back to "low" on a model
        that does not offer it."""
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
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": config,
        }
        try:
            data = self._call(model, body, attempts=attempts, timeout=timeout)
        except GeminiError as err:
            if not (thinking == "minimal" and err.status == 400 and "thinking" in err.detail.lower()):
                raise
            self._no_minimal.add(model)
            log.warn("thinking level minimal not offered, using low", model=model)
            config["thinkingConfig"] = {"thinkingLevel": "low"}
            data = self._call(model, body, attempts=attempts, timeout=timeout)
        when = datetime.now(timezone.utc)
        self._record(model, usage, read_usage(model, data.get("usageMetadata") or {}, when))

        candidates = data.get("candidates") or []
        if not candidates:
            raise GeminiError(None, "no candidates (blocked or empty)")
        parts = candidates[0].get("content", {}).get("parts") or []
        text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
        try:
            return json.loads(text)
        except ValueError:
            raise GeminiError(None, "response was not JSON") from None

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
        data = self._call(model, body, timeout=timeout)
        self._record(model, usage, read_usage(model, data.get("usageMetadata") or {}, datetime.now(timezone.utc)))
        parts = ((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
        inline = next((p["inlineData"] for p in parts if isinstance(p.get("inlineData"), dict)), None)
        if not inline or not inline.get("data"):
            raise GeminiError(None, "no audio (blocked or empty)")
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
        data = self._call(model, body, EMBED_ENDPOINT)
        when = datetime.now(timezone.utc)
        metadata = data.get("usageMetadata") or {}
        if not metadata.get("promptTokenCount"):
            # The embedding API may not report tokens; about four characters a token is close for email text.
            metadata = {"promptTokenCount": sum(len(t) for t in texts) // 4 + len(texts)}
        self._record(model, usage, read_usage(model, metadata, when))

        vectors = [normalise(e.get("values") or []) for e in data.get("embeddings") or []]
        if len(vectors) != len(texts) or any(len(v) != EMBED_DIMENSIONS for v in vectors):
            raise GeminiError(None, "embeddings missing or the wrong size")
        return vectors

    def _call(self, model: str, body: dict[str, Any], endpoint: str = ENDPOINT, *, attempts: int = 4, timeout: float = 90) -> dict[str, Any]:
        payload = json.dumps(body).encode()
        headers = {"Content-Type": "application/json", "x-goog-api-key": self._key}
        for attempt in range(attempts):
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
            log.warn("usage not recorded", code=getattr(err, "code", None) or type(err).__name__)
