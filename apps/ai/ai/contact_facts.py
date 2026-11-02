"""What is already known about one contact, read from stored summaries only: the contact's own notes, the summaries of
their conversations, who you are waiting on, and the summaries and action items of meetings with them. No message
text is read and no model is called, so the client card (people_card.py) and the meeting prep (prep.py) share one
cheap, sealed-field-aware read. The helpers that turn it into text are pure and tested without a database."""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from .fields import (
    CONTACT_ABOUT,
    CONTACT_COMPANY,
    CONTACT_RELATIONSHIP,
    CONTACT_ROLE,
    CONTACT_SUMMARY,
    MEETING_ACTIONS,
    MEETING_TITLE,
    NAME,
    SUBJECT,
    SUMMARY,
)
from .supabase import Supabase, in_list
from .vault import Vault

THREADS_KEPT = 12  # newest conversations read per contact
MEETINGS_KEPT = 3
SUBJECT_CHARS = 120
SUMMARY_CHARS = 260
CHANNELS = {"email": "Email", "gmail": "Email", "whatsapp": "WhatsApp", "instagram": "Instagram", "linkedin": "LinkedIn"}


@dataclass
class ThreadFact:
    id: str
    subject: str
    summary: str
    last_message_at: str
    channel: str
    last_from_me: bool
    needs_reply: bool  # they wrote last and it wants an answer from you
    waiting_on_them: bool  # you wrote last and follow_ups says it expects an answer


@dataclass
class MeetingFact:
    title: str
    started_at: str
    summary: str
    actions: list[str] = field(default_factory=list)


@dataclass
class Facts:
    contact_id: str
    name: str
    about: str = ""  # what the AI notes say about them (contacts.ai_summary)
    note: str = ""  # what you wrote about them
    company: str = ""
    role: str = ""
    relationship: str = ""
    threads: list[ThreadFact] = field(default_factory=list)  # newest first
    meetings: list[MeetingFact] = field(default_factory=list)  # newest first

    def activity_at(self) -> str | None:
        """The newest conversation or meeting time, which is when something last happened with them."""
        times = [t.last_message_at for t in self.threads if t.last_message_at] + [m.started_at for m in self.meetings if m.started_at]
        return max(times, key=_ts) if times else None


def _ts(value: str) -> datetime:
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def days_ago(value: str | None, now: datetime) -> int | None:
    """Whole days from value to now, never negative; None when there is no readable time."""
    if not value:
        return None
    try:
        return max(0, (now - _ts(value)).days)
    except ValueError:
        return None


def ago_text(value: str | None, now: datetime) -> str:
    """'today', 'yesterday' or 'N days ago', so a model (or a brief) never does date arithmetic."""
    days = days_ago(value, now)
    if days is None:
        return "unknown"
    return "today" if days == 0 else "yesterday" if days == 1 else f"{days} days ago"


def parse_actions(value: Any) -> list[str]:
    """The action items of a meeting: JSON text holding a list of sentences. Anything else is none."""
    try:
        items = json.loads(value) if isinstance(value, str) else value
    except ValueError:
        return []
    return [a.strip() for a in items if isinstance(a, str) and a.strip()] if isinstance(items, list) else []


def preferred_channel(threads: list[ThreadFact]) -> str | None:
    """The channel most of their recent conversations are on; on a tie the one used most recently. None for no
    conversations. Computed here because the model is only as good as the counts it is given."""
    if not threads:
        return None
    counts = Counter(t.channel for t in threads)
    best = max(counts.values())
    for t in threads:  # newest first
        if counts[t.channel] == best:
            return CHANNELS.get(t.channel, t.channel.title())
    return None


def clip(text: str, limit: int) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "..."


def load_facts(db: Supabase, vault: Vault, user_id: str, contact_id: str) -> Facts | None:
    """Reads and opens what is stored about a contact. None when the contact no longer exists."""
    contact = db.first(
        "contacts",
        {"select": "id,display_name,ai_summary,about_note,company,role,relationship", "id": f"eq.{contact_id}", "user_id": f"eq.{user_id}"},
    )
    if not contact:
        return None
    vault.open_row(
        user_id,
        contact,
        [("display_name", NAME), ("ai_summary", CONTACT_SUMMARY), ("about_note", CONTACT_ABOUT), ("company", CONTACT_COMPANY), ("role", CONTACT_ROLE), ("relationship", CONTACT_RELATIONSHIP)],
    )
    facts = Facts(
        contact_id,
        clip(contact.get("display_name") or "", 80) or "Them",
        clip(contact.get("ai_summary") or "", 600),
        clip(contact.get("about_note") or "", 400),
        clip(contact.get("company") or "", 80),
        clip(contact.get("role") or "", 80),
        clip(contact.get("relationship") or "", 80),
    )
    links = db.select("thread_participants", {"select": "thread_id", "user_id": f"eq.{user_id}", "contact_id": f"eq.{contact_id}", "limit": "200"})
    ids = sorted({r["thread_id"] for r in links})
    if ids:
        rows = db.select(
            "threads",
            {
                "select": "id,subject,summary,last_message_at,channel,last_from_me,needs_reply,is_group,junk,status",
                "user_id": f"eq.{user_id}",
                "id": in_list(ids[:200]),
                "order": "last_message_at.desc",
                "limit": str(THREADS_KEPT * 2),  # some are dropped below
            },
        )
        rows = [r for r in rows if not r.get("junk") and not r.get("is_group") and r.get("status") != "trash"][:THREADS_KEPT]
        waiting = {
            r["thread_id"]
            for r in (db.select("follow_ups", {"select": "thread_id", "user_id": f"eq.{user_id}", "expects_reply": "eq.true", "thread_id": in_list([r["id"] for r in rows])}) if rows else [])
        }
        for r in rows:
            vault.open_row(user_id, r, [("subject", SUBJECT), ("summary", SUMMARY)])
            mine = bool(r.get("last_from_me"))
            facts.threads.append(
                ThreadFact(
                    r["id"],
                    clip(r.get("subject") or "", SUBJECT_CHARS),
                    clip(r.get("summary") or "", SUMMARY_CHARS),
                    r.get("last_message_at") or "",
                    r.get("channel") or "email",
                    mine,
                    bool(r.get("needs_reply")) and not mine,
                    mine and r["id"] in waiting,
                )
            )
    facts.meetings = _meetings(db, vault, user_id, contact_id)
    return facts


def _meetings(db: Supabase, vault: Vault, user_id: str, contact_id: str) -> list[MeetingFact]:
    links = db.select("meeting_participants", {"select": "meeting_id", "user_id": f"eq.{user_id}", "contact_id": f"eq.{contact_id}", "limit": "200"})
    ids = sorted({r["meeting_id"] for r in links})
    if not ids:
        return []
    rows = db.select(
        "meetings",
        {
            "select": "id,title,started_at,summary,action_items,status",
            "user_id": f"eq.{user_id}",
            "id": in_list(ids),
            "status": "eq.summarised",
            "order": "started_at.desc",
            "limit": str(MEETINGS_KEPT),
        },
    )
    out: list[MeetingFact] = []
    for r in rows:
        vault.open_row(user_id, r, [("title", MEETING_TITLE), ("summary", SUMMARY), ("action_items", MEETING_ACTIONS)])
        out.append(MeetingFact(clip(r.get("title") or "", SUBJECT_CHARS), r["started_at"], clip(r.get("summary") or "", 400), parse_actions(r.get("action_items"))[:5]))
    return out


def facts_lines(f: Facts, now: datetime) -> list[str]:
    """Everything known about a contact as plain lines for a prompt, with the day counts already worked out."""
    lines = [f"Name: {f.name}"]
    for label, value in (("Company", f.company), ("Role", f.role), ("Relationship", f.relationship), ("Your notes on them", f.note), ("What the AI has noted", f.about)):
        if value:
            lines.append(f"{label}: {value}")
    last = f.activity_at()
    lines.append(f"Last activity: {ago_text(last, now)}")
    channel = preferred_channel(f.threads)
    if channel:
        lines.append(f"Most used channel: {channel}")
    if f.threads:
        lines += ["", "Recent conversations, newest first:"]
        for t in f.threads:
            state = "they are waiting on you" if t.needs_reply else "you are waiting on them" if t.waiting_on_them else "no reply pending"
            lines.append(f"- {t.subject or '(no subject)'} ({CHANNELS.get(t.channel, t.channel)}, {ago_text(t.last_message_at, now)}, {state}): {t.summary or 'no summary yet'}")
    if f.meetings:
        lines += ["", "Meetings with them, newest first:"]
        for m in f.meetings:
            acts = f" Action items: {'; '.join(m.actions)}." if m.actions else ""
            lines.append(f"- {m.title or 'Meeting'} ({ago_text(m.started_at, now)}): {m.summary or 'no summary'}{acts}")
    return lines


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
