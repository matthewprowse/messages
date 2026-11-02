"""Feature flags and kill switches for the AI worker: the same feature_flags table the sync worker reads (apps/worker/src/flags.ts),
edited by the owner in Admin.

A flag that is enabled is a switch thrown (pause this, disable that). An empty user list means everyone; a list limits it to
those people, and a check made with no person in mind is not hit by a per-person switch. Rows are cached for CACHE_S so a hot
path (every Gemini call) costs no query. If they cannot be read the last good rows stay in force, and before any read works
every switch is off: a missing table must never stop the product.

Choke points: gemini_budget._check_budget (pause_all_ai, pause_documents, pause_automations), drafts_gather._limited
(pause_predrafts) and the Instagram connector's reconcile (disable_connector_instagram)."""

from __future__ import annotations

import threading
import time
from typing import Any, Callable

from . import log

CACHE_S = 15.0  # how long a read is trusted; short, so a switch thrown in Admin bites within seconds

PAUSE_ALL_AI = "pause_all_ai"
PAUSE_PREDRAFTS = "pause_predrafts"
DISABLE_INSTAGRAM = "disable_connector_instagram"

# Features that have a switch of their own besides pause_all_ai. Drafts asked for stay on; pre-drafts have theirs above.
FEATURE_FLAGS = {"documents": "pause_documents", "automations": "pause_automations"}


def flag_applies(row: dict[str, Any] | None, user_id: str | None) -> bool:
    """Whether one flag row is thrown for this person (or for everyone when no person is given)."""
    if not row or not row.get("enabled"):
        return False
    people = row.get("user_ids") or []
    if not people:
        return True
    return user_id is not None and user_id in people


class Flags:
    def __init__(self, db: Any, cache_s: float = CACHE_S, clock: Callable[[], float] = time.monotonic):
        self._db = db
        self._cache_s = cache_s
        self._clock = clock
        self._rows: dict[str, dict[str, Any]] = {}
        self._read_at: float | None = None
        self._lock = threading.Lock()
        self._warned = False

    def _refresh(self) -> None:
        now = self._clock()
        if self._read_at is not None and now - self._read_at < self._cache_s:
            return
        try:
            rows = self._db.select("feature_flags", {"select": "key,enabled,user_ids"})
            self._rows = {r["key"]: r for r in rows}
        except Exception as err:
            if not self._warned:
                log.warn("feature flags not read, all switches off until they are", code=log.code_of(err))
                self._warned = True
        self._read_at = now  # stamped on failure too, so a broken table is asked again after the cache time

    def is_on(self, key: str, user_id: str | None = None) -> bool:
        """True when the switch is thrown for this person. Never raises."""
        with self._lock:
            self._refresh()
            return flag_applies(self._rows.get(key), user_id)

    def blocks_feature(self, feature: str, user_id: str | None) -> bool:
        """True when a Gemini call for this feature must not be made: everything is paused, or the feature's own switch is thrown."""
        if self.is_on(PAUSE_ALL_AI, user_id):
            return True
        own = FEATURE_FLAGS.get(feature)
        return bool(own) and self.is_on(own, user_id)


def flags_for(db: Any) -> Flags:
    """The one Flags reader for a database client, made on first use and kept on it, so every module shares one cache."""
    reader = getattr(db, "_konva_flags", None)
    if reader is None:
        reader = Flags(db)
        try:
            db._konva_flags = reader
        except Exception:
            pass
    return reader
