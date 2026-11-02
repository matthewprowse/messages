"""The Files API and context caching side of the Gemini client: upload a large file, delete it, cache it for
repeated calls. A mixin of Gemini; uses the client's key, billing breaker and recorder."""

from __future__ import annotations

import http.client
import json
import time
from datetime import datetime, timezone

from . import log
from .gemini_estimate import error_reason
from .gemini_types import CACHE_ENDPOINT, FILE_ENDPOINT, FILE_READY_S, UPLOAD_ENDPOINT, GeminiError, Usage, UsageContext, guarded
from .http import POOL
from .pricing import cost_usd


class FilesMixin:
    @guarded
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
                raise self._failure(res.status, *error_reason(res.body))
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
            raise self._failure(sent.status, *error_reason(sent.body))
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
