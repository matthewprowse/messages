"""The client summary card: one paragraph on where things stand with a contact ("Quote sent 12 Oct, awaiting
signature, last contact 9 days ago, prefers WhatsApp"), shown on their contact page. It is built from stored
summaries only (contact_facts.py), never from message text, in one small call, and sealed in client_cards.card.

A card is rewritten when something new happened with the contact (a message or a meeting summary) and it is at
least CARD_MIN_AGE_S old, so at most once a day. The Refresh button asks for one out of turn: the database caps those
asks per contact per day (request_client_card_refresh), this job only honours requested_at. Billed as `learn`, the
feature that already has the people summaries' share of the budget, and counted with them against summaries_per_day.
Only people who already have an AI summary (people you have written to) get cards unasked."""

from __future__ import annotations

import time
from datetime import datetime, timedelta
from typing import Any

from . import log
from .contact_facts import Facts, days_ago, facts_lines, load_facts, utcnow
from .fields import CONTACT_SUMMARY
from .gemini import DEFAULT_LIMITS, Gemini, GeminiError, UsageContext
from .supabase import Supabase, in_list
from .text import UNTRUSTED, fenced, new_fence
from .vault import Vault
from .voice import tidy_rule

CARD_MIN_AGE_S = 24 * 3600  # an automatic card is rewritten once a day at most
CARDS_PER_RUN = 3
REQUESTS_READ = 20
PROBE_LIMIT = 1000
CARD_CHARS = 600
RETRY_S = 6 * 3600
PENDING_MAX = 500  # contacts waiting for a turn, so a burst of mail cannot grow the set without end

CARD_SCHEMA = {
    "type": "object",
    "properties": {"card": {"type": "string", "description": "One paragraph, at most 60 words."}},
    "required": ["card"],
}

CARD_SYSTEM = """You write a client card for a professional: one short paragraph on where things stand with one
contact, so they can glance at it before replying or meeting. Write to them as "you".

Say, using only the facts given: the latest state of the work or deal (what was sent or agreed, and what is
outstanding), who is waiting on whom, when you last had contact (copy the day count you are given, never work it
out), and the channel they prefer if one is given. Plain, specific sentences, at most 60 words. If the facts do
not say, leave it out; never guess a date, amount or promise. No greeting, no advice, no bullet points, and
never use em dashes.""" + UNTRUSTED


def card_prompt(facts: Facts, now: datetime, fence: str | None = None) -> str:
    """The facts as one fenced block. Summaries were made from other people's messages, so all of it is data."""
    return fenced("\n".join(facts_lines(facts, now)), fence or new_fence())


def tidy_card(text: Any) -> str:
    return tidy_rule(str(text or ""))[:CARD_CHARS].strip()


def card_due(card: dict[str, Any] | None, activity_at: str | None, has_summary: bool, now: datetime) -> str | None:
    """Why a card should be written now: "requested" (the Refresh button, ahead of the daily limit), "activity"
    (something new since the card and a day old), or None. card is the client_cards row, if any."""
    updated = card.get("updated_at") if card else None
    requested = card.get("requested_at") if card else None
    if requested and (not updated or _ts(requested) > _ts(updated)):
        return "requested"
    if not has_summary or not activity_at:
        return None
    if card and card.get("activity_at") and _ts(activity_at) <= _ts(card["activity_at"]) and card.get("card"):
        return None
    if updated and (now - _ts(updated)).total_seconds() < CARD_MIN_AGE_S:
        return None
    return "activity"


def _ts(value: str) -> datetime:
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


class ClientCards:
    def __init__(self, db: Supabase, gemini: Gemini, model: str, vault: Vault | None = None):
        self.db = db
        self.gemini = gemini
        self.model = model
        self.vault = vault or Vault(db)
        self._probed: str | None = None
        self._pending: dict[tuple[str, str], None] = {}  # (user, contact) with new activity, in arrival order
        self._skip: dict[str, float] = {}  # contact -> monotonic time to retry after a failure
        self._today: dict[str, list[Any]] = {}  # user -> [date, cards written today]

    def run_once(self) -> int:
        started = utcnow()
        now = started
        done = 0
        for card in self._requests():
            if done >= CARDS_PER_RUN:
                break
            done += self._work(card["user_id"], card["contact_id"], card, now)
        self._probe(started)
        for key in list(self._pending):
            if done >= CARDS_PER_RUN:
                break
            user_id, contact_id = key
            card = self.db.first("client_cards", {"select": "*", "contact_id": f"eq.{contact_id}", "user_id": f"eq.{user_id}"})
            done += self._work(user_id, contact_id, card, now)
            self._pending.pop(key, None)
        return done

    def _requests(self) -> list[dict[str, Any]]:
        rows = self.db.select(
            "client_cards", {"select": "*", "requested_at": "not.is.null", "order": "requested_at.asc", "limit": str(REQUESTS_READ)}
        )
        return [r for r in rows if (not r.get("updated_at") or _ts(r["requested_at"]) > _ts(r["updated_at"])) and not self._skipped(r["contact_id"])]

    def _probe(self, started: datetime) -> None:
        """Finds contacts with new messages or newly summarised meetings since the last look, with one read of each
        table for everyone, and queues the ones who already have an AI summary."""
        since = self._probed
        msg = {"select": "user_id,thread_id", "order": "created_at.desc", "limit": str(PROBE_LIMIT)}
        meet = {"select": "user_id,id", "status": "eq.summarised", "order": "updated_at.desc", "limit": "200"}
        if since:
            msg["created_at"] = f"gte.{since}"
            meet["updated_at"] = f"gte.{since}"
        self._probed = (started - timedelta(minutes=1)).isoformat()  # a little back, so a row written during the read is not missed
        found: set[tuple[str, str]] = set()
        threads = {(r["user_id"], r["thread_id"]) for r in self.db.select("messages", msg)}
        for user_id, ids in _by_user(threads).items():
            for i in range(0, len(ids), 100):
                for r in self.db.select("thread_participants", {"select": "contact_id", "user_id": f"eq.{user_id}", "thread_id": in_list(ids[i : i + 100])}):
                    found.add((user_id, r["contact_id"]))
        meetings = {(r["user_id"], r["id"]) for r in self.db.select("meetings", meet)}
        for user_id, ids in _by_user(meetings).items():
            for i in range(0, len(ids), 100):
                for r in self.db.select("meeting_participants", {"select": "contact_id", "user_id": f"eq.{user_id}", "meeting_id": in_list(ids[i : i + 100]), "contact_id": "not.is.null"}):
                    found.add((user_id, r["contact_id"]))
        for user_id, contacts in _by_user(found).items():
            for i in range(0, len(contacts), 100):
                rows = self.db.select("contacts", {"select": "id", "user_id": f"eq.{user_id}", "ai_summary": "not.is.null", "id": in_list(contacts[i : i + 100])})
                for r in rows:
                    if len(self._pending) < PENDING_MAX:
                        self._pending[(user_id, r["id"])] = None

    def _skipped(self, contact_id: str) -> bool:
        until = self._skip.get(contact_id)
        if until is None:
            return False
        if time.monotonic() >= until:
            del self._skip[contact_id]
            return False
        return True

    def _cards_left(self, user_id: str, now: datetime) -> bool:
        """False once the person has had summaries_per_day cards written today (UTC); counted with the people summaries' cap."""
        today = now.date()
        made = self._today.get(user_id)
        if made is None or made[0] != today:
            try:
                count = self.db.count("client_cards", {"user_id": f"eq.{user_id}", "updated_at": f"gte.{today.isoformat()}T00:00:00+00:00"})
            except Exception as err:  # never hold cards up over the count
                log.warn("card count not read", code=log.code_of(err))
                return True
            made = self._today[user_id] = [today, count]
        cap = self.gemini.limits()["summaries_per_day"] if hasattr(self.gemini, "limits") else DEFAULT_LIMITS["summaries_per_day"]
        return made[1] < cap

    def _work(self, user_id: str, contact_id: str, card: dict[str, Any] | None, now: datetime) -> int:
        if self._skipped(contact_id):
            return 0
        try:
            return int(self._write(user_id, contact_id, card, now))
        except Exception as err:  # one contact's failure never ends the others' turn
            self._skip[contact_id] = time.monotonic() + RETRY_S
            log.error("client card failed", contact=contact_id, code=log.code_of(err))
            return 0

    def _write(self, user_id: str, contact_id: str, card: dict[str, Any] | None, now: datetime) -> bool:
        facts = load_facts(self.db, self.vault, user_id, contact_id)
        if facts is None:
            return False
        activity = facts.activity_at()
        why = card_due(card, activity, bool(facts.about), now)
        if why is None:
            return False
        if not self._cards_left(user_id, now):
            return False
        if not facts.threads and not facts.meetings:  # nothing to say; stamp it so a request is not answered forever
            self.db.upsert("client_cards", {"contact_id": contact_id, "user_id": user_id, "updated_at": now.isoformat(), "activity_at": activity}, "contact_id")
            return False
        try:
            result = self.gemini.json(
                self.model, CARD_SYSTEM, card_prompt(facts, now), CARD_SCHEMA, UsageContext(user_id, "learn"), thinking="minimal", max_output=512
            )
        except GeminiError as err:
            self._skip[contact_id] = time.monotonic() + RETRY_S
            log.warn("client card failed", contact=contact_id, status=err.status)
            return False
        text = tidy_card(result.get("card"))
        if not text:
            return False
        self.db.upsert(
            "client_cards",
            {"contact_id": contact_id, "user_id": user_id, "card": self.vault.seal(user_id, CONTACT_SUMMARY, text), "updated_at": now.isoformat(), "activity_at": activity},
            "contact_id",
        )
        made = self._today.get(user_id)
        if made:
            made[1] += 1
        log.info("client card written", contact=contact_id, why=why, days=days_ago(activity, now))
        return True


def _by_user(pairs: set[tuple[str, str]]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for user_id, value in pairs:
        out.setdefault(user_id, []).append(value)
    return {u: sorted(v) for u, v in out.items()}
