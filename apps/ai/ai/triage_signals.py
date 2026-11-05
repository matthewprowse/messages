"""Triage rules that need no model: the constants shared by the triage modules, the per-user context, your own
signals (rules, unsubscribes, corrections) that win over the model, and how a batch is grouped and queried. Pure:
no network. Split out of triage.py, which re-exports every name here."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from .retry import not_in
from .triage_extras import AutoLabel

PRIORITIES = ["urgent", "important", "normal", "low"]
CATEGORIES = ["personal", "work", "needs_reply", "fyi", "newsletter", "notification"]
LOOKBACK_DAYS = 30
VOICE_WAIT_S = 15 * 60  # how long a voice note waits for its transcript before it is triaged without one
VOICE_RECHECK_S = 20
BATCH = 24
GROUP = 8  # emails per model call
BODY_CHARS = 2500
BULK_BODY_CHARS = 1200  # bulk mail (a list-unsubscribe header) fills 2500 characters but classifies the same from 800 to 1200
CONTEXT_MESSAGES = 4  # earlier messages of the conversation shown with the one being judged
CONTEXT_CHARS = 300  # each of them is cut to this, so a long thread stays cheap
SUBJECT_CHARS = 300  # a subject is not a second body: a long one is cut before the prompt
CONTEXT_TTL_S = 60  # what is known about a user (rules, unsubscribes, corrections) is reread this often
LATEST_ROWS = 1000
OPTION_KINDS = ["accept", "decline", "other_time", "answer"]
MAX_OPTIONS = 4
SENDER_KEEP = 2  # the model's last answers about a bulk sender that must all agree before it is skipped
SENDER_RECHECK_DAYS = 30  # the model looks at a skipped sender again once its last answer is this old
BULK_CATEGORIES = ("newsletter", "notification")
NO_CHOICES = json.dumps({"options": []})  # looked at, nothing to offer: the backfill skips it

@dataclass
class UserContext:
    name: str = ""  # profiles.display_name, so summaries can say "you" instead of it
    own_addresses: list[str] = field(default_factory=list)  # their accounts' addresses, for the same reason
    about: str = ""
    important_people: str = ""
    always: list[str] = field(default_factory=list)
    never: list[str] = field(default_factory=list)
    unsubscribed: set[str] = field(default_factory=set)
    corrections: list[str] = field(default_factory=list)
    accounts: list[str] = field(default_factory=list)  # every connected account, for finding the same email twice
    timezone: str = ""  # profiles.timezone, for the time of day in a message's traits
    language: str = ""  # profiles.language: en-GB, en-US or af; empty follows how they write
    vip_contacts: set[str] = field(default_factory=set)  # contacts.vip: starred people, whose mail is never junk
    auto_labels: list[AutoLabel] = field(default_factory=list)  # labels.auto: up to 6 the model may put on a conversation


def matches(address: str, targets: list[str]) -> bool:
    """A rule target is a whole address or a domain (with or without @)."""
    address = address.lower()
    domain = address.split("@")[-1]
    for t in targets:
        t = t.strip().lower()
        if not t:
            continue
        if t == address or t.lstrip("@") == domain or domain.endswith("." + t.lstrip("@")):
            return True
    return False


def apply_signals(result: dict[str, Any], sender: str, ctx: UserContext, thread_feedback: list[str], sender_contact: str | None = None) -> dict[str, Any]:
    """Your own signals override the model. thread_feedback is newest first. sender_contact is the contact the
    message came from: a starred one (VIP) is at least important and never junk, unless you unsubscribed."""
    out = dict(result)
    if out.get("priority") not in PRIORITIES:
        out["priority"] = "normal"
    if out.get("category") not in CATEGORIES:
        out["category"] = "fyi"
    out["summary"] = str(out.get("summary") or "")[:200]

    if sender and sender.lower() in ctx.unsubscribed:
        out.update(junk=True, priority="low", needs_reply=False)
    if sender and matches(sender, ctx.never):
        out.update(priority="low")
    if sender and matches(sender, ctx.always):
        out.update(junk=False, priority="urgent" if out["priority"] == "urgent" else "important")
    if sender_contact and sender_contact in ctx.vip_contacts and not (sender and sender.lower() in ctx.unsubscribed):
        out.update(junk=False, priority="urgent" if out["priority"] == "urgent" else "important")

    for value in thread_feedback:  # the latest correction on this conversation wins per kind
        if value in ("junk", "not_junk"):
            out["junk"] = value == "junk"
            break
    for value in thread_feedback:
        if value in ("important", "not_important"):
            out["priority"] = ("urgent" if out["priority"] == "urgent" else "important") if value == "important" else "low"
            break
    if "no_reply_needed" in thread_feedback:
        out["needs_reply"] = False
    if out["junk"]:
        out["needs_reply"] = False
    # Choices only while a reply is needed. None leaves reply_choices empty; NO_CHOICES means looked at.
    out["choices"] = (out.get("choices") or NO_CHOICES) if out["needs_reply"] else None
    return out


def known_outcome(m: dict[str, Any], ctx: UserContext, thread_feedback: list[str]) -> dict[str, Any] | None:
    """A result your own signals already settle, so no model call is needed: a sender you unsubscribed
    from, or a conversation whose latest junk correction is Junk. thread_feedback is newest first."""
    sender = (m.get("sender_address") or "").lower()
    unsubscribed = bool(sender) and sender in ctx.unsubscribed
    junk_mark = next((v for v in thread_feedback if v in ("junk", "not_junk")), None)
    if not unsubscribed and junk_mark != "junk":
        return None
    category = "newsletter" if unsubscribed or m.get("list_unsubscribe") else "fyi"
    return {"priority": "low", "category": category, "junk": True, "needs_reply": False, "summary": (m.get("subject") or "")[:200]}


def sender_outcome(m: dict[str, Any], history: list[dict[str, Any]], now: datetime) -> dict[str, Any] | None:
    """A bulk sender the model has settled on: its last SENDER_KEEP answers (history, newest first, from
    public.sender_history) were all junk newsletters or notifications of low or normal priority that
    wanted no reply, none of their conversations was ever corrected, and the newest answer is under
    SENDER_RECHECK_DAYS old, so the model still looks at each sender now and then. The result is the
    newest answer with the subject as its summary, as known_outcome has it. None when any of that fails."""
    if not (m.get("is_bulk") or m.get("list_unsubscribe")) or len(history) < SENDER_KEEP:
        return None
    for h in history:
        if h["corrected"] or not h["junk"] or h["needs_reply"] or h["category"] not in BULK_CATEGORIES or h["priority"] not in ("low", "normal"):
            return None
    newest = history[0]
    try:
        decided = datetime.fromisoformat(str(newest["decided_at"]).replace("Z", "+00:00"))
    except ValueError:
        return None
    if now - decided > timedelta(days=SENDER_RECHECK_DAYS):
        return None
    return {"priority": newest["priority"], "category": newest["category"], "junk": True, "needs_reply": False, "summary": (m.get("subject") or "")[:200]}


def superseded_outcome(m: dict[str, Any]) -> dict[str, Any]:
    """For an older message in a conversation with a newer incoming one. Only the latest decides the
    conversation, so this is a placeholder that marks the message as done."""
    return {"priority": "normal", "category": "fyi", "junk": False, "needs_reply": False, "summary": (m.get("subject") or "")[:200]}


def latest_incoming(rows: list[dict[str, Any]], batch: list[dict[str, Any]]) -> dict[str, tuple[bool, bool] | None]:
    """For each message in batch: (is the latest incoming message of its conversation, the conversation's
    latest message of all is incoming), or None when rows cannot tell. rows are messages of those
    conversations, newest first, cut off at some point: a message is decided only when it is among them,
    as then everything newer is too."""
    seen = {r["id"] for r in rows}
    first_in: dict[str, str] = {}
    first_any: dict[str, str] = {}
    for r in rows:
        first_any.setdefault(r["thread_id"], r["direction"])
        if r["direction"] == "inbound":
            first_in.setdefault(r["thread_id"], r["id"])
    return {
        m["id"]: (first_in.get(m["thread_id"]) == m["id"], first_any.get(m["thread_id"]) == "inbound") if m["id"] in seen else None
        for m in batch
    }

def groups(messages: list[dict[str, Any]], size: int = GROUP) -> list[list[dict[str, Any]]]:
    """Messages split per user and account (usage is filed per account), at most size each."""
    by: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for m in messages:
        by.setdefault((m["user_id"], m["account_id"]), []).append(m)
    return [batch[i : i + size] for batch in by.values() for i in range(0, len(batch), size)]


def pending_query(since: str, skip: list[str] | None = None) -> dict[str, str]:
    """Incoming messages since `since` with no triage yet, in conversations where triage is on.
    threads!inner makes the thread filter part of the same query (an inner join), so conversations
    with triage off, such as WhatsApp groups until you opt in, are never fetched at all. `skip` leaves
    out messages waiting out a back-off after failing, so the ones behind them still get their turn."""
    return {
        **not_in(skip or []),
        # Bodies are fetched later, only for the messages the model is asked about.
        "select": "id,user_id,account_id,thread_id,provider_message_id,subject,sender_address,sender_contact_id,"
        "list_unsubscribe,is_bulk,sender_index,sent_at,transcript,transcript_status,message_ai(message_id),threads!inner(triage_enabled,channel,is_group),attachments(filename)",
        "direction": "eq.inbound",
        "message_ai": "is.null",
        "threads.triage_enabled": "eq.true",
        # Old mail waiting on a half price batch is held out (triage_batch.py) until its answer is back.
        "or": f"(triage_hold_until.is.null,triage_hold_until.lt.{datetime.now(timezone.utc).isoformat()})",
        "sent_at": f"gte.{since}",
        "order": "sent_at.desc",
        "limit": str(BATCH),
    }


# Per-sender cap -----------------------------------------------------------------------------------
# Anyone can write to you, so one outside sender must not be able to spend your AI allowance by sending hundreds of
# messages. Past SENDER_DAILY_CAP model reads for one sender in a UTC day, their messages get capped_outcome instead.
# A sender can change addresses, so the same cap applies to their domain, and strangers (senders who are nobody in
# your contacts) share one bigger cap per user: past it the rest of the day's strangers are capped too, while the
# people you know are read as before.
SENDER_DAILY_CAP = 40  # model reads per sender per user per UTC day; a real correspondent stays far below it
DOMAIN_DAILY_CAP = 40  # model reads per sender domain per user per UTC day; a mailbox provider's domain is exempt
STRANGER_DAILY_CAP = 150  # model reads of mail from senders not in your contacts, per user per UTC day

# Domains many unrelated people write from: a cap per domain would let one stranger cap them all.
SHARED_DOMAINS = frozenset({
    "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "icloud.com",
    "me.com", "mac.com", "protonmail.com", "proton.me", "aol.com", "mail.com", "webmail.co.za", "mweb.co.za",
    "telkomsa.net", "vodamail.co.za", "ymail.com", "gmx.com", "zoho.com",
})


def sender_key(m: dict[str, Any]) -> tuple[str, str]:
    """Who a message is from, per user: the blind index when there is one, else the opened address, else the conversation
    (a WhatsApp chat is one sender)."""
    return (m["user_id"], m.get("sender_index") or (m.get("sender_address") or "").lower() or f"thread:{m.get('thread_id')}")


def domain_key(m: dict[str, Any]) -> tuple[str, str] | None:
    """The sender's domain, per user, when the address is readable and the domain is not one everybody uses."""
    address = (m.get("sender_address") or "").lower()
    domain = address.rsplit("@", 1)[1] if "@" in address else ""
    return (m["user_id"], f"domain:{domain}") if domain and domain not in SHARED_DOMAINS else None


def stranger_key(m: dict[str, Any]) -> tuple[str, str] | None:
    """One key for every sender who is not a contact of this user, or None for one who is."""
    return None if m.get("sender_contact_id") else (m["user_id"], "strangers")


def capped_outcome(m: dict[str, Any]) -> dict[str, Any]:
    """The verdict for a message over its sender's daily cap: left visible and unjudged (normal, not junk), as nothing
    was asked. It still passes through apply_signals, so your rules, stars and corrections apply."""
    return {"priority": "normal", "category": "fyi", "junk": False, "needs_reply": False, "summary": (m.get("subject") or "")[:200]}


class SenderCaps:
    """Counts model reads per sender per UTC day, in memory: a restart starts the day's count again, which only ever
    lets a sender through sooner. Not thread safe on its own; triage calls it from its one loop thread."""

    def __init__(self, cap: int = SENDER_DAILY_CAP, domain_cap: int = DOMAIN_DAILY_CAP, stranger_cap: int = STRANGER_DAILY_CAP):
        self.cap, self.domain_cap, self.stranger_cap = cap, domain_cap, stranger_cap
        self._day = ""
        self._counts: dict[tuple[str, str], int] = {}

    def split(self, ask: list[dict[str, Any]], ctx: dict[str, UserContext], now: datetime | None = None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """(the messages the model may read, the ones over their sender's cap), counting the first. A starred contact or a
        sender on your Always list is never capped. ask is newest first, so the newest of a flood are the ones read."""
        day = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%d")
        if day != self._day:
            self._day, self._counts = day, {}
        keep: list[dict[str, Any]] = []
        over: list[dict[str, Any]] = []
        for m in ask:
            c = ctx.get(m["user_id"]) or UserContext()
            if m.get("sender_contact_id") in c.vip_contacts or matches(m.get("sender_address") or "", c.always):
                keep.append(m)
                continue
            limits = [(sender_key(m), self.cap)]
            if (domain := domain_key(m)) is not None:
                limits.append((domain, self.domain_cap))
            if (stranger := stranger_key(m)) is not None:
                limits.append((stranger, self.stranger_cap))
            if any(self._counts.get(key, 0) >= cap for key, cap in limits):
                over.append(m)
            else:
                for key, _ in limits:
                    self._counts[key] = self._counts.get(key, 0) + 1
                keep.append(m)
        return keep, over
