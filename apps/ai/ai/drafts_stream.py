"""A draft shown while it is written. The model's answer is JSON ({"body": "..."}), streamed a few words at a time
(gemini_stream.py); the body read so far is sealed into the pending draft row at most every EVERY_S, and Realtime
takes it to the app, which shows it read-only in the reply box until the finished draft arrives.

Nothing about the draft changes: the finished answer is still checked for unsupported details (and asked again when
it has them), and its write replaces the text shown. Only a draft someone is waiting on is streamed, never a pre-draft
or a new message. Writes go one at a time on the reads pool, the newest text winning; each only matches the row while
it is pending, so a late one can never overwrite the finished draft."""

from __future__ import annotations

import json
import threading
import time
from concurrent.futures import Executor
from typing import Any

from . import log
from .fields import DRAFT
from .text import plain_dashes
from .vault import Vault

EVERY_S = 0.25  # Realtime and the database take a write this often easily; a reply is two to ten writes
MIN_CHARS = 12  # a few words before the first write, so the box does not flash one letter


def partial_string(text: str, key: str = "body") -> str | None:
    """The value of key in a JSON object that is still being written, as far as it has come, or None before it starts.
    An escape cut off at the end is left out until the rest arrives."""
    at = text.find(json.dumps(key))
    if at < 0:
        return None
    i = at + len(json.dumps(key))
    while i < len(text) and text[i] in " \t\r\n:":
        i += 1
    if i >= len(text) or text[i] != '"':
        return None
    i += 1
    out: list[str] = []
    while i < len(text):
        c = text[i]
        if c == '"':
            break
        if c != "\\":
            out.append(c)
            i += 1
            continue
        if i + 1 >= len(text):
            break
        e = text[i + 1]
        if e == "u":
            code = text[i + 2 : i + 6]
            if len(code) < 4:
                break
            try:
                out.append(chr(int(code, 16)))
            except ValueError:
                break
            i += 6
            continue
        out.append({"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f"}.get(e, e))
        i += 2
    joined = "".join(out)
    # A surrogate pair cut in half by the stream is held back with the rest of the escape.
    return joined[:-1] if joined and "\ud800" <= joined[-1] <= "\udbff" else joined


class Shown:
    """on_text for one draft: writes the body so far to the pending row, throttled, on pool."""

    def __init__(self, db: Any, vault: Vault, d: dict[str, Any], pool: Executor):
        self.db, self.vault, self.d, self.pool = db, vault, d, pool
        self._lock = threading.Lock()
        self._busy = False
        self._last = 0.0
        self._wanted: str | None = None
        self._written = ""

    def __call__(self, text: str) -> None:
        body = partial_string(text)
        if body is None:
            return
        body = plain_dashes(body)
        if len(body.strip()) < MIN_CHARS:
            return
        with self._lock:
            self._wanted = body
            if self._busy or time.monotonic() - self._last < EVERY_S:
                return
            self._busy = True
        self.pool.submit(self._write)

    def _write(self) -> None:
        while True:
            with self._lock:
                body = self._wanted
                if body is None or body == self._written:
                    self._busy = False
                    return
                self._written, self._last = body, time.monotonic()
            try:
                sealed = self.vault.seal(self.d["user_id"], DRAFT, body, "drafts.body", self.d["id"])
                self.db.update("drafts", {"id": f"eq.{self.d['id']}", "user_id": f"eq.{self.d['user_id']}", "status": "eq.pending"}, {"body": sealed}, minimal=True)
                self.d["_shown"] = True  # the row holds part of a body: Drafts._fail clears it
            except Exception as err:
                log.warn("draft text not shown", draft=self.d["id"], code=log.code_of(err))
                with self._lock:
                    self._busy = False
                return
            with self._lock:  # newer text came while writing: write it once the gap has passed, or leave it to the next piece
                if self._wanted == self._written or time.monotonic() - self._last < EVERY_S:
                    self._busy = False
                    return
