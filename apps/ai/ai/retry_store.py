"""retry.Backoff kept in the database (public.ai_retries), so a restart does not give every message the model keeps
refusing another paid try. It behaves exactly like Backoff in memory; each failure is also written (kind, id, count and
the wall-clock time to retry at) and each success removes the row. The rows are read once at start and turned back
into the monotonic clock the rest of the worker uses.

A database that cannot be read or written never stops the worker: it falls back to plain in-memory back-off and logs
the code. Ids and counts only."""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Any

from . import log
from .retry import FIRST_WAIT_S, MAX_WAIT_S, Backoff
from .supabase import missing_relation

PRUNE_DAYS = 7
LOAD_LIMIT = 2000 # rows read at start; the most recent retries matter, and waiting() only ever returns MAX_EXCLUDED


class PersistentBackoff(Backoff):
    def __init__(self, db: Any, kind: str):
        super().__init__()
        self.db = db
        self.kind = kind
        self._load()

    def _load(self) -> None:
        try:
            rows = self.db.select("ai_retries", {"select": "row_id,failures,retry_at", "kind": f"eq.{self.kind}", "order": "retry_at.desc", "limit": str(LOAD_LIMIT)})
        except Exception as err:
            if not missing_relation(err):
                log.warn("retry state not read", kind=self.kind, code=log.code_of(err))
            return
        try:  # a row whose retry time passed long ago is for a message since deleted or settled another way
            self.db.delete("ai_retries", {"kind": f"eq.{self.kind}", "retry_at": f"lt.{(datetime.now(timezone.utc) - timedelta(days=PRUNE_DAYS)).isoformat()}"})
        except Exception:
            pass
        wall, mono = time.time(), time.monotonic()
        for r in rows:
            try:
                at = datetime.fromisoformat(str(r["retry_at"]).replace("Z", "+00:00")).timestamp()
                self._failures[str(r["row_id"])] = (int(r["failures"]), mono + (at - wall))
            except (KeyError, ValueError, TypeError):
                continue
        if rows:
            log.info("retry state loaded", kind=self.kind, rows=len(rows))

    def failed(self, row_id: str, now: float) -> int:
        count = super().failed(row_id, now)
        wait = min(MAX_WAIT_S, FIRST_WAIT_S * 2 ** (count - 1))
        retry_at = datetime.now(timezone.utc) + timedelta(seconds=wait)
        try:
            self.db.upsert("ai_retries", {"kind": self.kind, "row_id": row_id, "failures": count, "retry_at": retry_at.isoformat()}, "kind,row_id")
        except Exception as err:
            if not missing_relation(err):
                log.warn("retry state not saved", kind=self.kind, code=log.code_of(err))
        return count

    def succeeded(self, row_id: str) -> None:
        known = row_id in self._failures
        super().succeeded(row_id)
        if not known:
            return  # nothing was stored for it
        try:
            self.db.delete("ai_retries", {"kind": f"eq.{self.kind}", "row_id": f"eq.{row_id}"})
        except Exception as err:
            if not missing_relation(err):
                log.warn("retry state not cleared", kind=self.kind, code=log.code_of(err))
