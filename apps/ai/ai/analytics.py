"""Content-free product analytics: what the AI did, how long it took and what it cost, as events.

An event is a name and a few small values: numbers, yes/no and plain code words (lowercase, no spaces).
Never text from a message, a name, an address or anything typed. The database refuses anything else too
(analytics_clean_props), and a user who turned off Share Usage Data records nothing. Events are written in
the background and never raise, so analytics can never slow down or break the AI."""

from __future__ import annotations

import hashlib
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from . import log
from .supabase import Supabase

WORD = re.compile(r"^[a-z][a-z0-9_.:-]{0,39}$")
GENERIC_SENDERS = {
    "noreply", "no-reply", "donotreply", "do-not-reply", "info", "support", "help", "hello", "team", "sales", "billing",
    "accounts", "admin", "contact", "notifications", "notification", "news", "newsletter", "mail", "service", "office",
    "customercare", "orders", "invoices", "marketing", "updates", "alerts", "security", "careers", "jobs",
}


def word(value: Any) -> str | None:
    """value if it is a plain code word, else None. Text is dropped, never tidied into a word."""
    return value if isinstance(value, str) and WORD.match(value) else None


def prompt_id(*texts: str) -> str:
    """A short code for the exact instructions sent to the model, so results can be compared by prompt."""
    return "p" + hashlib.sha1("\n".join(texts).encode()).hexdigest()[:7]


def length_bucket(chars: int | None) -> str:
    if chars is None:
        return "unknown"
    return "short" if chars < 300 else "medium" if chars < 1500 else "long"


def hour_bucket(sent_at: str | None, timezone: str | None) -> str:
    try:
        when = datetime.fromisoformat((sent_at or "").replace("Z", "+00:00"))
        hour = when.astimezone(ZoneInfo(timezone or "UTC")).hour
    except (ValueError, KeyError, OSError):
        return "unknown"
    return "night" if hour < 6 else "morning" if hour < 12 else "afternoon" if hour < 18 else "evening"


def sender_kind(address: str, bulk: bool, group: bool) -> str:
    if group:
        return "group"
    if bulk:
        return "bulk"
    local = re.sub(r"[+].*$", "", address.split("@")[0].lower())
    return "company" if local in GENERIC_SENDERS or re.fullmatch(r"(no-?reply|do-?not-?reply)[\d._-]*", local) else "person"


def traits(m: dict[str, Any], source: str, *, chars: int | None, known: bool, timezone: str | None) -> dict[str, Any]:
    """Facts about an incoming message that explain how it was labelled, and none of its content."""
    thread = m.get("threads") or {}
    bulk = bool(m.get("list_unsubscribe"))
    return {
        "channel": thread.get("channel") or "email",
        "sender": sender_kind(m.get("sender_address") or "", bulk, bool(thread.get("is_group"))),
        "bulk": bulk,
        "attach": bool(m.get("attachments")),
        "len": length_bucket(chars),
        "hour": hour_bucket(m.get("sent_at"), timezone),
        "known": known,
        "source": source,
    }


def event(name: str, **props: Any) -> dict[str, Any]:
    """An event with only the values that are numbers, flags, plain code words or lists of them."""
    clean: dict[str, Any] = {}
    for key, value in props.items():
        if isinstance(value, bool) or (isinstance(value, (int, float)) and abs(value) <= 1_000_000_000):
            clean[key] = value
        elif word(value):
            clean[key] = value
        elif isinstance(value, list):
            clean[key] = [v for v in value if word(v)][:12]
    return {"name": name, "props": clean}


class Analytics:
    def __init__(self, db: Supabase):
        self._db = db
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="analytics")  # finishes its queue on exit

    def emit(self, user_id: str, events: list[dict[str, Any]]) -> None:
        if events:
            self._pool.submit(self._write, user_id, events)

    def _write(self, user_id: str, events: list[dict[str, Any]]) -> None:
        try:
            for i in range(0, len(events), 50):
                self._db.rpc("analytics_record", {"p_user": user_id, "p_events": events[i : i + 50]})
        except Exception as err:  # never lose work over analytics; a database without the migration just skips it
            log.warn("analytics not recorded", code=log.code_of(err))
