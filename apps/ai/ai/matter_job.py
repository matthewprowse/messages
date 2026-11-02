"""The Same Matter job: runs matter.suggest for people with recent conversations.

matter.suggest scores one user's threads; this picks whose to score, a few at a time. Only conversations active in the last
day bring a user up, so quiet accounts cost nothing. No model confirmation is passed, so borderline pairs are dropped and the
job never calls Gemini (docs/PLAN.md, Same Matter)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from . import log
from .matter import suggest
from .similar import SimilarIndex

ACTIVE_HOURS = 24  # a user is looked at when one of their conversations moved within this window
USERS_PER_RUN = 20  # so one run stays short between triage batches


def recent_users(rows: list[dict[str, Any]], limit: int = USERS_PER_RUN) -> list[str]:
    """Distinct user ids in the order their newest conversation moved, at most `limit`."""
    seen: list[str] = []
    for r in rows:
        u = r.get("user_id")
        if u and u not in seen:
            seen.append(u)
        if len(seen) >= limit:
            break
    return seen


class MatterJob:
    def __init__(self, db: Any, vault: Any, index: SimilarIndex | None = None):
        self.db = db
        self.index = index or SimilarIndex(db, vault)

    def run_once(self) -> int:
        """Suggests same-matter links for recently active users; returns how many links were written."""
        since = (datetime.now(UTC) - timedelta(hours=ACTIVE_HOURS)).isoformat()
        rows = self.db.select("threads", {"select": "user_id", "last_message_at": f"gte.{since}", "order": "last_message_at.desc", "limit": "500"})
        written = 0
        for user_id in recent_users(rows):
            try:
                written += suggest(self.db, self.index, user_id)
            except Exception as err:
                log.warn("same matter failed", code=log.code_of(err))
        return written
