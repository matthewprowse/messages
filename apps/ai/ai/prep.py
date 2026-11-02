"""Meeting prep: 30 minutes before a calendar event with attendees you know, a short brief for each of them (who they
are, your last three conversations, what is still open between you, the last meeting with them and what they asked
for), stored sealed in event_preps for the calendar event details and the Summary's "Prep" link.

No model is called. Everything comes from summaries that are already stored (contact_facts.py), arranged by a
template, so prep costs nothing and cannot invent a promise. It reads and writes only event_preps (one row per
event, rebuilt if the event moves); the web app decides what to show."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any

from . import log
from .contact_facts import CHANNELS, Facts, MeetingFact, ThreadFact, ago_text, clip, load_facts, utcnow
from .crypto import address_index
from .fields import ADDRESS, SUMMARY
from .supabase import Supabase, in_list
from .vault import Vault

LEAD = timedelta(minutes=30)  # how long before the start the brief is built
EVENTS_PER_RUN = 20
MAX_PEOPLE = 8  # attendees briefed per event
RECENT = 3  # conversations listed per person
MAX_PROMISES = 5


def _ts(value: str) -> datetime:
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def who_line(f: Facts) -> str:
    """Who they are: role and company when known, else the first sentence or so of what the AI has noted."""
    role = " at ".join(p for p in (f.role, f.company) if p)
    head = ", ".join(p for p in (role, f.relationship) if p)
    if head:
        return head
    return clip(f.about, 200)


def thread_line(t: ThreadFact, now: datetime) -> str:
    channel = CHANNELS.get(t.channel, t.channel)
    detail = f"{channel}, {ago_text(t.last_message_at, now)}"
    return f"{t.subject or 'No subject'} ({detail}): {t.summary}" if t.summary else f"{t.subject or 'No subject'} ({detail})"


def meeting_line(m: MeetingFact, now: datetime) -> str:
    return f"{m.title or 'Meeting'} ({ago_text(m.started_at, now)}): {m.summary}" if m.summary else f"{m.title or 'Meeting'} ({ago_text(m.started_at, now)})"


def person_brief(f: Facts, now: datetime) -> dict[str, Any]:
    """One attendee's brief as plain data. Promises are what is open on either side: replies you owe, replies you are
    waiting for, and the action items of the last meeting. asked is what their latest message wanting an answer was about."""
    promises: list[str] = []
    for t in f.threads:
        if t.needs_reply:
            promises.append(f"You owe a reply: {t.subject or 'No subject'} ({ago_text(t.last_message_at, now)})")
        elif t.waiting_on_them:
            promises.append(f"Waiting on {f.name}: {t.subject or 'No subject'} ({ago_text(t.last_message_at, now)})")
    last_meeting = f.meetings[0] if f.meetings else None
    if last_meeting:
        promises += [f"From the last meeting: {a}" for a in last_meeting.actions]
    asking = next((t for t in f.threads if t.needs_reply), None)
    return {
        "contact_id": f.contact_id,
        "name": f.name,
        "who": who_line(f),
        "recent": [thread_line(t, now) for t in f.threads[:RECENT]],
        "promises": promises[:MAX_PROMISES],
        "last_meeting": meeting_line(last_meeting, now) if last_meeting else None,
        "asked": clip(asking.summary or asking.subject, 240) if asking else None,
    }


def prep_due(events: list[dict[str, Any]], preps: dict[str, str], now: datetime) -> list[dict[str, Any]]:
    """Events that start within LEAD, have not started, are not all day, list guests and have no brief for their current
    start. preps maps event id to the start its brief was built for."""
    due = []
    for e in events:
        if e.get("all_day") or not e.get("attendees"):
            continue
        start = _ts(e["starts_at"])
        if not (now <= start <= now + LEAD):
            continue
        built = preps.get(e["id"])
        if built and _ts(built) == start:
            continue
        due.append(e)
    return sorted(due, key=lambda e: e["starts_at"])


def guest_emails(attendees: Any) -> list[str]:
    """Lowercase addresses of the guests that are not you, in order, without repeats."""
    seen: dict[str, None] = {}
    for a in attendees if isinstance(attendees, list) else []:
        if isinstance(a, dict) and isinstance(a.get("email"), str) and not a.get("self") and not a.get("resource"):
            seen.setdefault(a["email"].strip().lower(), None)
    return [e for e in seen if e][: MAX_PEOPLE * 3]


class Prep:
    def __init__(self, db: Supabase, vault: Vault | None = None):
        self.db = db
        self.vault = vault or Vault(db)
        self._empty: set[tuple[str, str]] = set()  # (event, start) with nobody known, so it is not looked at every run

    def run_once(self, now: datetime | None = None) -> int:
        now = now or utcnow()
        events = self.db.select(
            "calendar_events",
            {
                "select": "id,user_id,starts_at,all_day,attendees",
                "all_day": "eq.false",
                "starts_at": f"gte.{now.isoformat()}",
                "and": f"(starts_at.lte.{(now + LEAD).isoformat()})",
                "order": "starts_at.asc",
                "limit": "200",
            },
        )
        if not events:
            return 0
        preps = {r["event_id"]: r["starts_at"] for r in self.db.select("event_preps", {"select": "event_id,starts_at", "event_id": in_list([e["id"] for e in events])})}
        done = 0
        for event in prep_due(events, preps, now)[:EVENTS_PER_RUN]:
            if (event["id"], event["starts_at"]) in self._empty:
                continue
            try:
                done += int(self._prepare(event, now))
            except Exception as err:  # one event's failure never ends the others' turn
                log.error("meeting prep failed", event=event["id"], code=log.code_of(err))
        return done

    def _prepare(self, event: dict[str, Any], now: datetime) -> bool:
        user_id = event["user_id"]
        keys = self.vault.keys_for(user_id)
        if not keys:
            return False
        emails = [self.vault.open(user_id, ADDRESS, e) or e for e in guest_emails(event["attendees"])]
        by_index = {address_index(keys, e): e for e in emails}
        rows = self.db.select(
            "contact_identities", {"select": "contact_id,value_index", "user_id": f"eq.{user_id}", "kind": "eq.email", "value_index": in_list(sorted(by_index))}
        ) if by_index else []
        contact_ids = list(dict.fromkeys(r["contact_id"] for r in rows if r.get("value_index") in by_index))[:MAX_PEOPLE]
        people = []
        for contact_id in contact_ids:
            facts = load_facts(self.db, self.vault, user_id, contact_id)
            if facts:
                people.append(person_brief(facts, now))
        if not people:  # nobody you know: nothing to brief
            self._empty.add((event["id"], event["starts_at"]))
            return False
        brief = json.dumps({"v": 1, "people": people}, ensure_ascii=False)
        self.db.upsert(
            "event_preps", {"event_id": event["id"], "user_id": user_id, "brief": self.vault.seal(user_id, SUMMARY, brief), "starts_at": event["starts_at"]}, "event_id"
        )
        log.info("meeting prep written", event=event["id"], people=len(people))
        return True
