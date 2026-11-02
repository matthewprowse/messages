"""Promises made in a conversation: "I'll send the quote by Friday", "they will confirm Monday".

The follow-up check (chasers.py) already reads the end of each conversation, so the same call also lists the promises in
those two messages: no extra model call. This module is the part that needs no model: cleaning what the model said,
sealing it into public.commitments, and bringing a conversation back when the other person's promise has passed its
date unanswered. Pure helpers first (tested in tests/test_commitments.py), then the database step.

What the model returns is untrusted text from a third party's message: it is cut to a short length, stripped of
line breaks and sealed with the user's key; the app shows it as plain text. Only counts are logged."""

from __future__ import annotations

import re
from datetime import date, datetime, time as dtime, timedelta, timezone
from typing import Any

from . import log
from .fields import TASK_TITLE
from .supabase import Supabase, in_list
from .vault import Vault

MAX_PER_MESSAGE = 3  # promises kept from one conversation's two messages
TEXT_CHARS = 200
PAST_DAYS = 45  # a due date further back than this is a misreading, so the promise is kept without a date
FUTURE_DAYS = 400
NUDGE_HOUR_UTC = 6  # 08:00 in South Africa, the hour a returned conversation comes back at elsewhere in the app
SWEEP_LIMIT = 200

# The part of the follow-up schema that lists promises; chasers.py puts it inside each conversation's answer.
SCHEMA: dict[str, Any] = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "What was promised, in a few words, such as Send the quote."},
            "owner": {"type": "string", "enum": ["me", "them"], "description": "me: the person you work for promised it. them: the other person did."},
            "due": {"type": "string", "description": "The day as YYYY-MM-DD, worked out from today's date, or an empty string when no day was named."},
            "said_in": {"type": "string", "enum": ["last", "before"], "description": "last: in the person you work for's last message. before: in the other person's message above it."},
        },
        "required": ["text", "owner", "due", "said_in"],
    },
}

INSTRUCTIONS = """Also list each clear promise to do something (send, confirm, call back, pay, deliver, book) made in
those two messages, by the person you work for (owner me) or by the other person (owner them), with the day it is due
when one is named ("by Friday", "Monday", "tomorrow"), worked out from today's date. A question, a hope, an offer
waiting on a yes, or something already done is not a promise. Write each in a few words from the promiser's side, such
as "Send the quote". At most three per conversation; none is the usual answer."""


def parse_due(value: Any, today: date) -> date | None:
    """A YYYY-MM-DD day the model gave, or None when it is empty, unreadable or implausibly far from today."""
    try:
        day = date.fromisoformat(str(value or "").strip()[:10])
    except ValueError:
        return None
    return day if today - timedelta(days=PAST_DAYS) <= day <= today + timedelta(days=FUTURE_DAYS) else None


def clean_commitments(raw: Any, today: date) -> list[dict[str, Any]]:
    """The model's list as safe rows: {text, owner, due (date or None), said_in}. Unknown owners and empty text are
    dropped, text is one short line, and exact repeats are kept once."""
    out: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        owner = str(item.get("owner") or "").strip().lower()
        text = re.sub(r"\s+", " ", str(item.get("text") or "")).strip()[:TEXT_CHARS]
        if owner not in ("me", "them") or not text or (owner, text.lower()) in seen:
            continue
        seen.add((owner, text.lower()))
        said_in = "before" if str(item.get("said_in") or "").strip().lower() == "before" else "last"
        out.append({"text": text, "owner": owner, "due": parse_due(item.get("due"), today), "said_in": said_in})
        if len(out) == MAX_PER_MESSAGE:
            break
    return out


def commitment_rows(user: str, thread: str, before: dict[str, Any] | None, mine: dict[str, Any], items: list[dict[str, Any]], vault: Vault) -> list[dict[str, Any]]:
    """Rows for public.commitments. The evidence is the message the promise was said in; one said in "before" when
    there is no such message falls back to your own. seq keeps a message's promises apart so a re-read cannot repeat them."""
    rows = []
    for seq, c in enumerate(items):
        evidence = before if c["said_in"] == "before" and before else mine
        rows.append({
            "user_id": user,
            "thread_id": thread,
            "message_id": evidence["id"],
            "seq": seq,
            "owner": c["owner"],
            "text": vault.seal(user, TASK_TITLE, c["text"]),
            "due_on": c["due"].isoformat() if c["due"] else None,
        })
    return rows


def nudge_time(due_on: str) -> datetime:
    """When a promise of theirs counts as missed: the morning after its day."""
    return datetime.combine(date.fromisoformat(due_on[:10]) + timedelta(days=1), dtime(NUDGE_HOUR_UTC, 0), timezone.utc)


def _when(value: Any) -> datetime:
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def due_nudges(rows: list[dict[str, Any]], threads: dict[str, dict[str, Any]], sent: dict[str, Any], now: datetime) -> list[dict[str, Any]]:
    """The open promises of theirs whose conversation should come back: the morning after the date has passed, the
    conversation is in Inbox and not snoozed to a later time, the promise is not snoozed, and they have not written
    since the message it was made in (a newer message from them clears a snooze anyway). sent maps a message id to its time."""
    out = []
    for r in rows:
        t = threads.get(r["thread_id"])
        if not t or t.get("status") != "inbox" or t.get("junk") or not r.get("due_on"):
            continue
        if nudge_time(r["due_on"]) > now:
            continue
        if r.get("snoozed_until") and _when(r["snoozed_until"]) > now:
            continue
        if t.get("snoozed_until") and _when(t["snoozed_until"]) > now:
            continue
        said = sent.get(r["message_id"])
        # Unanswered: the last message is yours, or nothing from them came after the one the promise was in.
        if not t.get("last_from_me") and said is not None and _when(t["last_message_at"]) > _when(said):
            continue
        out.append(r)
    return out


def sweep(db: Supabase, now: datetime) -> int:
    """Brings back conversations whose promise from the other person has passed its date unanswered, by the same
    reminder mechanism as Remind Me If No Reply (snooze_kind reminder, already due), so the app shows Follow Up. Returns
    how many promises were acted on. A user's own snooze to a later time is never overridden."""
    today = now.date().isoformat()
    rows = db.select("commitments", {"select": "id,user_id,thread_id,message_id,due_on,snoozed_until", "owner": "eq.them", "status": "eq.open", "nudged_at": "is.null", "due_on": f"lt.{today}", "limit": str(SWEEP_LIMIT)})
    if not rows:
        return 0
    threads = {t["id"]: t for t in db.select("threads", {"select": "id,status,junk,last_from_me,last_message_at,snoozed_until", "id": in_list(sorted({r["thread_id"] for r in rows}))})}
    sent = {m["id"]: m["sent_at"] for m in db.select("messages", {"select": "id,sent_at", "id": in_list(sorted({r["message_id"] for r in rows}))})}
    due = due_nudges(rows, threads, sent, now)
    stamp = now.isoformat()
    for thread_id in sorted({r["thread_id"] for r in due}):
        db.update("threads", {"id": f"eq.{thread_id}"}, {"snoozed_until": stamp, "snooze_kind": "reminder", "snoozed_at": stamp}, minimal=True)
    for r in due:
        db.update("commitments", {"id": f"eq.{r['id']}"}, {"nudged_at": stamp}, minimal=True)
    if due:
        log.info("promises missed", count=len(due))
    return len(due)
