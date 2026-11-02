"""Pure helpers behind Gemini calls: reading usage and cost from a response, estimating a call's cost before it
is made, reading retry waits and error reasons, and small audio and vector utilities. No network, no database."""

from __future__ import annotations

import io
import json
import re
import wave
from datetime import datetime, timezone
from typing import Any

from .gemini_types import AUDIO_BYTES_PER_SECOND, DEFAULT_OUTPUT_ESTIMATE, Usage
from .pricing import AUDIO_TOKENS_PER_SECOND, cost_usd, price_or_fallback

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
