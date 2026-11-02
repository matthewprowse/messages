"""Claims on the rows the AI worker pays Gemini for (drafts, triage groups, voice notes), so two AI workers never
both take the same row. A claim is one database call (public.claim_ai_rows: insert or take over a stale claim), so
the second worker simply does not get the row. A claim nobody finished goes stale after stale_s and can be taken
again; finishing, or failing in a way worth another try, releases it.

Until the migration is applied the claim is skipped (every id is granted) and a warning is logged once, so the
worker keeps working as before, only without the second-instance guard. Ids and counts only; never content."""

from __future__ import annotations

import uuid
from typing import Any

from . import log
from .supabase import missing_relation

STALE_S = {"draft": 180, "triage": 300, "transcribe": 600}  # longer than the work takes, short enough to recover from a crash
DEFAULT_STALE_S = 300


class Claims:
    def __init__(self, db: Any, holder: str | None = None):
        self.db = db
        self.holder = holder or uuid.uuid4().hex  # one per process: a restart is a new holder, whose claims go stale
        self._warned = False

    def claim(self, kind: str, ids: list[str], stale_s: int | None = None) -> set[str]:
        """The ids this process now holds. Ids another worker holds are left out. A missing function grants all
        (unguarded, as before the migration); any other failure grants none, so the rows are simply looked at again
        on the next pass rather than risk paying twice."""
        ids = [i for i in dict.fromkeys(ids) if i]
        if not ids:
            return set()
        try:
            got = self.db.rpc("claim_ai_rows", {"p_kind": kind, "p_ids": ids, "p_holder": self.holder, "p_stale_seconds": stale_s or STALE_S.get(kind, DEFAULT_STALE_S)})
        except Exception as err:
            if missing_relation(err):
                if not self._warned:
                    self._warned = True
                    log.warn("ai claims not available, rows are not guarded against a second worker (apply the migration)")
                return set(ids)
            log.warn("ai rows not claimed", kind=kind, code=log.code_of(err))
            return set()
        return {str(i) for i in (got or [])} & set(ids)

    def release(self, kind: str, ids: list[str]) -> None:
        """Gives claims back. Never raises: a claim left behind goes stale on its own."""
        ids = [i for i in dict.fromkeys(ids) if i]
        if not ids:
            return
        try:
            self.db.rpc("release_ai_claims", {"p_kind": kind, "p_ids": ids, "p_holder": self.holder})
        except Exception as err:
            if not missing_relation(err):
                log.warn("ai claims not released", kind=kind, code=log.code_of(err))
