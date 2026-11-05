"""A Gemini call read as it is written (streamGenerateContent, server-sent events), so a draft can be shown word by word
while the model is still writing it. A mixin of Gemini; json(on_text=...) uses it.

The answer is the same as a plain call's: the same request, with the pieces put back together into one response of the
shape _call returns (the text, finish reason and usage of the last piece), so everything after the call is unchanged.
on_text is given the text so far after each piece. A stream that fails is not tried again as a stream: the call falls
back to the ordinary _call with its retries, and a stream cut off part way is counted as lost, since Gemini may bill it.
A billing failure is never retried either way."""

from __future__ import annotations

import http.client
import json
from typing import Any, Callable

from . import log
from .billing import is_billing_error
from .gemini_estimate import error_reason
from .gemini_types import ENDPOINT, GeminiError, guarded
from .http import POOL, Refused

STREAM_ENDPOINT = ENDPOINT.replace(":generateContent", ":streamGenerateContent?alt=sse")


class StreamMixin:
    def _call_streamed(
        self, model: str, body: dict[str, Any], on_text: Callable[[str], None], *, attempts: int, timeout: float, stats: dict[str, int]
    ) -> dict[str, Any]:
        """_call, read as a stream, with on_text told the text so far as it grows. Falls back to _call when the stream
        fails before its end."""
        data = self._stream_once(model, body, on_text, timeout=timeout, stats=stats)
        if data is None:
            return self._call(model, body, attempts=max(1, attempts - 1), timeout=timeout, stats=stats)
        return data

    @guarded
    def _stream_once(self, model: str, body: dict[str, Any], on_text: Callable[[str], None], *, timeout: float, stats: dict[str, int]) -> dict[str, Any] | None:
        """One streamed request behind the billing breaker. None when it failed for a reason worth one plain try."""
        stats["attempts"] = stats.get("attempts", 0) + 1
        text, last, started = "", {}, False
        try:
            for raw in POOL.stream("POST", STREAM_ENDPOINT.format(model=model), json.dumps(body).encode(), self._headers(), timeout=timeout):
                line = raw.strip()
                if not line.startswith(b"data:"):
                    continue
                piece = json.loads(line[5:])
                last = piece
                parts = ((piece.get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
                more = "".join(p.get("text", "") for p in parts if not p.get("thought"))
                if more:
                    started = True
                    text += more
                    try:
                        on_text(text)
                    except Exception as err:  # showing it is a nicety: the answer still counts
                        log.warn("draft text not shown", code=log.code_of(err))
        except Refused as err:
            reason, detail = error_reason(err.response.body)
            if is_billing_error(err.response.status, reason, detail):
                raise self._failure(err.response.status, reason, detail) from None
            log.info("gemini stream refused, sent again whole", status=err.response.status)
            return None
        except (OSError, http.client.HTTPException, ValueError) as err:
            if started:
                stats["lost"] = stats.get("lost", 0) + 1  # part answered: Gemini may still bill it
            log.info("gemini stream cut off, sent again whole", code=type(err).__name__)
            return None
        candidate = dict((last.get("candidates") or [{}])[0])
        if not text and not candidate:
            raise GeminiError(None, "no candidates (blocked or empty)")
        candidate["content"] = {"parts": [{"text": text}]}
        return {**last, "candidates": [candidate]}
