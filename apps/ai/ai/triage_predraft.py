"""Pre-drafts asked for by triage: when a new message is the latest in its conversation and triage says it needs a
reply, the worker asks for a pre-draft (public.queue_auto_draft) at once, so the reply is usually written before the
conversation is opened, with the app open or not. Before this only the open app asked (request_auto_draft).

queue_auto_draft makes every check the app's ask makes (Auto-Draft Replies on, one to one, not junk, nothing written
since, at most 15 a day), so this only picks the candidates. Mail older than FRESH_S is left to the app: a backlog or
the first sort of a new account would spend the day's 15 on mail nobody is about to answer. The drafts job writes
them after the drafts people ask for, on the cheaper pre-draft model."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from . import log
from .supabase import Supabase, missing_relation

FRESH_S = 6 * 3600  # matches triage_batch.OLD_S: older mail is batched, and nobody is waiting on it


def fresh(sent_at: Any, now: datetime | None = None) -> bool:
    try:
        sent = datetime.fromisoformat(str(sent_at).replace("Z", "+00:00"))
    except ValueError:
        return False
    return ((now or datetime.now(timezone.utc)) - sent).total_seconds() < FRESH_S


def candidates(updates: list[dict[str, Any]], final: dict[str, dict[str, Any]], waiting: dict[str, bool]) -> list[dict[str, Any]]:
    """The messages of updates (each the latest in its conversation) worth a pre-draft: fresh, not junk, not flagged
    as suspicious (a reply written ahead to a phishing mail is a reply nobody asked for), needing a reply, and the
    other side is the one waiting. One per conversation. queue_auto_draft applies the same checks in the database."""
    seen: set[str] = set()
    out = []
    for m in updates:
        r = final.get(m["id"]) or {}
        if r.get("needs_reply") and not r.get("junk") and not r.get("suspicious") and waiting.get(m["id"]) and fresh(m.get("sent_at")) and m["thread_id"] not in seen:
            seen.add(m["thread_id"])
            out.append(m)
    return out


class PreDrafts:
    def __init__(self, db: Supabase):
        self.db = db
        self.missing = False  # queue_auto_draft is not in the database yet: stop asking until a restart

    def queue(self, messages: list[dict[str, Any]]) -> int:
        """Asks for a pre-draft of each conversation. Returns how many were queued. Never raises: a pre-draft that
        cannot be asked for is one the app asks for when the conversation is opened."""
        queued = 0
        for m in messages:
            if self.missing:
                break
            try:
                if self.db.rpc("queue_auto_draft", {"p_user": m["user_id"], "p_thread": m["thread_id"]}):
                    queued += 1
            except Exception as err:
                if missing_relation(err):
                    self.missing = True
                    log.warn("pre-drafts from triage off, queue_auto_draft missing")
                else:
                    log.warn("pre-draft not queued", code=log.code_of(err))
        if queued:
            log.info("pre-drafts queued", drafts=queued)
        return queued
