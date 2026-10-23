"""Triage: priority, category, junk and a one-line summary for each new incoming message.

The model decides first, then your own signals win: priority rules, senders you unsubscribed from,
and the Important / Not Important / Junk / Not Junk corrections you made in the app. Conversations
with triage turned off (WhatsApp groups start that way) are skipped.

The model is only asked when its answer is used. A conversation takes the triage of its latest
incoming message, so an older one in a conversation that has a newer one is recorded without a model
call; so is mail from a sender you unsubscribed from or in a conversation you marked Junk, and an
email already triaged in another of your accounts (the same Message-ID) is copied. The rest go to
the fast model GROUP at a time, per account, with minimal thinking: the instructions and what is
known about you are sent once for the group, first, so they are the same at the start of every call.

The same call offers guided drafting's one-tap choices for a message that needs a decision only you
can make ("Are you free Thursday at 3?"). Messages triaged before that existed get theirs when there
is nothing new to triage (backfill_choices), only while they still need a reply."""

from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from . import log
from .fields import ADDRESS, BODY, CHOICES, HTML, SUBJECT, SUMMARY, UNSUBSCRIBE
from .gemini import Gemini, GeminiError, UsageContext
from .retry import Backoff, not_in
from .supabase import Supabase, in_list
from .text import clean
from .vault import Vault

PRIORITIES = ["urgent", "important", "normal", "low"]
CATEGORIES = ["personal", "work", "needs_reply", "fyi", "newsletter", "notification"]
LOOKBACK_DAYS = 30
BATCH = 24
GROUP = 8  # emails per model call
BODY_CHARS = 2500
CONTEXT_TTL_S = 60  # what is known about a user (rules, unsubscribes, corrections) is reread this often
LATEST_ROWS = 1000
OPTION_KINDS = ["accept", "decline", "other_time", "answer"]
MAX_OPTIONS = 4
NO_CHOICES = json.dumps({"options": []})  # looked at, nothing to offer: the backfill skips it

SCHEMA = {
    "type": "object",
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "email": {"type": "integer", "description": "The number of the email this result is for."},
                    "priority": {"type": "string", "enum": PRIORITIES},
                    "category": {"type": "string", "enum": CATEGORIES},
                    "junk": {"type": "boolean"},
                    "needs_reply": {"type": "boolean"},
                    "summary": {"type": "string", "description": "One plain sentence, at most 120 characters."},
                    "choices": {
                        "type": "array",
                        "description": "One-tap reply choices, or empty.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string", "description": "Button text, 1 to 4 words, Title Case."},
                                "decision": {"type": "string", "description": "What they decided, one short first-person sentence."},
                                "kind": {"type": "string", "enum": OPTION_KINDS},
                            },
                            "required": ["label", "decision", "kind"],
                        },
                    },
                    "asked_time": {"type": "string", "description": "YYYY-MM-DDTHH:MM, or empty."},
                    "asked_minutes": {"type": "integer", "description": "Length in minutes, or 0."},
                },
                "required": ["email", "priority", "category", "junk", "needs_reply", "summary", "choices", "asked_time", "asked_minutes"],
            },
        }
    },
    "required": ["results"],
}

SYSTEM = """You sort one person's incoming email. For each numbered email, decide:

priority
- urgent: needs them within hours (a deadline today, a real security or money problem, a person waiting on them now).
- important: a real person writing to them personally, work they are part of, appointments, bills and anything with consequences.
- normal: useful but not pressing.
- low: everything else.
Routine login codes, sign-in links, verification and welcome emails are normal, not urgent: they are only useful the moment they were asked for. A security alert about something they did not do is urgent.

category: personal, work, needs_reply (a person is asking them something), fyi, newsletter, notification (automated account or service messages).

junk: true for mail that is not written for them: marketing, promotions, sales, cold outreach, mass newsletters, generic automated alerts and digests, surveys, spam. False for anything personal, any reply in a conversation they took part in, receipts, bookings, security codes, bills and notices about accounts they hold. Bulk mail (it has an unsubscribe header) is junk unless it clearly matters to them personally.

needs_reply: true only when a person expects an answer from them.

summary: one plain sentence saying what it is and what, if anything, they need to do. No greetings, no "This email".

choices: only when needs_reply is true and the answer needs a decision only they can make: whether they are free at a time, whether they will do or send something, a yes or no, which option, a price or an offer. Give 2 to 4 options they would realistically pick, each with:
- label: button text, 1 to 4 words in Title Case, such as "Yes, Available", "Not Available", "Sending Today", "Which Documents?".
- decision: what they decided, as one short first-person sentence the reply will say, such as "I am free on Thursday at 15:00 and will be there." Never add facts, prices or promises the option does not state.
- kind: accept (yes, agree, will do), decline (no, can't), other_time (offer a different time), answer (anything else, such as asking what they need).
When they are asked about a meeting, call or viewing time, include an other_time option labelled "Suggest Another Time". Otherwise, and whenever needs_reply is false, choices is empty.

asked_time: when the message asks whether they are free at a specific date and time, that time as YYYY-MM-DDTHH:MM, as written in the message (the sender's local time), working out the date from when it was sent. Otherwise empty. asked_minutes: how long it would take in minutes when stated or obvious, otherwise 0.

Use what you are told about them and their past corrections. Mail styled to look personal but sent to a list is still junk.

Judge each email on its own and return one result for every email, with its number."""


@dataclass
class UserContext:
    about: str = ""
    important_people: str = ""
    always: list[str] = field(default_factory=list)
    never: list[str] = field(default_factory=list)
    unsubscribed: set[str] = field(default_factory=set)
    corrections: list[str] = field(default_factory=list)
    accounts: list[str] = field(default_factory=list)  # every connected account, for finding the same email twice


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


def apply_signals(result: dict[str, Any], sender: str, ctx: UserContext, thread_feedback: list[str]) -> dict[str, Any]:
    """Your own signals override the model. thread_feedback is newest first."""
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

    for value in thread_feedback:  # the latest correction on this conversation wins per kind
        if value in ("junk", "not_junk"):
            out["junk"] = value == "junk"
            break
    for value in thread_feedback:
        if value in ("important", "not_important"):
            out["priority"] = ("urgent" if out["priority"] == "urgent" else "important") if value == "important" else "low"
            break
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
    return {"priority": "low", "category": category, "junk": True, "needs_reply": False, "summary": m.get("subject") or ""}


def superseded_outcome(m: dict[str, Any]) -> dict[str, Any]:
    """For an older message in a conversation with a newer incoming one. Only the latest decides the
    conversation, so this is a placeholder that marks the message as done."""
    return {"priority": "normal", "category": "fyi", "junk": False, "needs_reply": False, "summary": m.get("subject") or ""}


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


def triage_prompt(ctx: UserContext, emails: list[dict[str, Any]]) -> str:
    """What is known about them first (the same on every call of theirs), then the numbered emails.
    Each email has name, sender, relationship, known, bulk, subject and body."""
    lines = [
        f"About them: {ctx.about or 'not given'}",
        f"People who matter to them: {ctx.important_people or 'not given'}",
        "Their recent corrections: " + ("; ".join(ctx.corrections[:12]) or "none"),
    ]
    for i, e in enumerate(emails, 1):
        lines += [
            "",
            f"=== Email {i}",
            f"From: {e['name']} <{e['sender']}>",
            f"Relationship: {e['relationship'] or 'unknown'}",
            f"They have written to this sender before: {'yes' if e['known'] else 'no'}",
            f"Bulk mail with an unsubscribe header: {'yes' if e['bulk'] else 'no'}",
            f"Sent: {sent_label(e.get('sent'))}",
            f"Subject: {e['subject'] or '(none)'}",
            "",
            e["body"],
        ]
    return "\n".join(lines)


def sent_label(sent_at: str | None) -> str:
    """"Thursday 29 October 2026, 13:05 UTC", so the model can work out "tomorrow at 3"."""
    if not sent_at:
        return "unknown"
    try:
        at = datetime.fromisoformat(sent_at.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return "unknown"
    return at.strftime("%A %d %B %Y, %H:%M UTC")


def read_choices(item: dict[str, Any]) -> str:
    """The choices from one model answer as JSON for message_ai.reply_choices: NO_CHOICES when there are
    none or they are unusable. Options need a label and a decision; a known kind; at most MAX_OPTIONS."""
    options = []
    for o in item.get("choices") if isinstance(item.get("choices"), list) else []:
        if not isinstance(o, dict):
            continue
        label = " ".join(str(o.get("label") or "").split())[:40]
        decision = " ".join(str(o.get("decision") or "").split())[:300]
        kind = o.get("kind") if o.get("kind") in OPTION_KINDS else "answer"
        if label and decision and label.lower() not in {x["label"].lower() for x in options}:
            options.append({"label": label, "decision": decision, "kind": kind})
    options = options[:MAX_OPTIONS]
    if len(options) < 2:
        return NO_CHOICES
    asked = str(item.get("asked_time") or "").strip()
    try:
        asked = datetime.strptime(asked[:16], "%Y-%m-%dT%H:%M").strftime("%Y-%m-%dT%H:%M") if asked else None
    except ValueError:
        asked = None
    minutes = item.get("asked_minutes")
    minutes = minutes if isinstance(minutes, int) and 5 <= minutes <= 24 * 60 else None
    return json.dumps({"asked": asked, "minutes": minutes, "options": options})


def read_results(result: Any, count: int) -> dict[int, dict[str, Any]]:
    """The model's answers by email number, 1 to count. A missing or malformed answer is left out."""
    out: dict[int, dict[str, Any]] = {}
    items = result.get("results") if isinstance(result, dict) else None
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        try:
            n = int(item.get("email"))
        except (TypeError, ValueError):
            continue
        if not 1 <= n <= count or n in out or not isinstance(item.get("junk"), bool):
            continue
        out[n] = {
            "priority": item.get("priority"),
            "category": item.get("category"),
            "junk": item["junk"],
            "needs_reply": item.get("needs_reply") is True,
            "summary": str(item.get("summary") or ""),
            "choices": read_choices(item),
        }
    return out


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
        "list_unsubscribe,sent_at,message_ai(message_id),threads!inner(triage_enabled)",
        "direction": "eq.inbound",
        "message_ai": "is.null",
        "threads.triage_enabled": "eq.true",
        "sent_at": f"gte.{since}",
        "order": "sent_at.desc",
        "limit": str(BATCH),
    }


class Triage:
    def __init__(self, db: Supabase, gemini: Gemini, model: str, vault: Vault | None = None):
        self.db = db
        self.gemini = gemini
        self.model = model
        self.vault = vault or Vault(db)  # without one, plaintext passes through and nothing is encrypted
        self._backoff = Backoff()
        self._pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="triage")
        self._users: dict[str, tuple[float, UserContext]] = {}  # user_id -> (read at, context)

    def run_once(self) -> int:
        """Triages one batch. Returns how many were triaged, so the loop rests when nothing succeeded."""
        since = (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).isoformat()
        rows = self.db.select("messages", pending_query(since, self._backoff.waiting(time.monotonic())))
        if not rows:
            return self.backfill_choices(since)
        for r in rows:  # opened first: known_outcome and superseded_outcome copy the subject into the summary
            self.vault.open_row(r["user_id"], r, [("subject", SUBJECT), ("list_unsubscribe", UNSUBSCRIBE), ("sender_address", ADDRESS)])
        thread_ids = sorted({r["thread_id"] for r in rows})
        found = self._all(
            {
                "contexts": lambda: self._contexts(sorted({r["user_id"] for r in rows})),
                "feedback": lambda: self.db.select(
                    "feedback", {"select": "thread_id,value", "thread_id": in_list(thread_ids), "order": "created_at.desc", "limit": "1000"}
                ),
                "latest": lambda: self._latest(rows),
            }
        )
        contexts: dict[str, UserContext] = found["contexts"]
        feedback: dict[str, list[str]] = {}
        for f in found["feedback"]:
            feedback.setdefault(f["thread_id"], []).append(f["value"])
        latest: dict[str, tuple[bool, bool]] = found["latest"]

        # Decide what needs the model: (result, model) for the rest.
        results: dict[str, tuple[dict[str, Any], str | None]] = {}
        ask: list[dict[str, Any]] = []
        for m in rows:
            ctx = contexts[m["user_id"]]
            settled = known_outcome(m, ctx, feedback.get(m["thread_id"], []))
            if settled is not None:
                results[m["id"]] = (settled, None)
            elif not latest[m["id"]][0]:
                results[m["id"]] = (superseded_outcome(m), None)
            else:
                ask.append(m)
        twins = self._twins(ask, contexts)
        firsts: dict[tuple[str, str], dict[str, Any]] = {}  # the same email twice in this batch is asked about once
        copies: list[dict[str, Any]] = []
        for m in list(ask):
            key = (m["user_id"], m.get("provider_message_id") or m["id"])
            if key in twins:
                results[m["id"]] = twins[key]
                ask.remove(m)
            elif key in firsts:
                copies.append(m)
                ask.remove(m)
            else:
                firsts[key] = m

        asked = len(ask)
        if ask:
            for answers in self._pool.map(lambda chunk: self._ask(contexts[chunk[0]["user_id"]], chunk), self._prepare(ask, contexts)):
                results.update(answers)
        for m in copies:
            first = firsts[(m["user_id"], m.get("provider_message_id") or m["id"])]
            if first["id"] in results:
                results[m["id"]] = results[first["id"]]

        done = [m for m in rows if m["id"] in results]
        if not done:
            log.info("triage batch", messages=len(rows), triaged=0)
            return 0
        final = {m["id"]: apply_signals(results[m["id"]][0], (m.get("sender_address") or "").lower(), contexts[m["user_id"]], feedback.get(m["thread_id"], [])) for m in done}
        self.db.upsert(
            "message_ai",
            [
                {
                    "message_id": m["id"],
                    "user_id": m["user_id"],
                    "priority": final[m["id"]]["priority"],
                    "category": final[m["id"]]["category"],
                    "summary": self.vault.seal(m["user_id"], SUMMARY, final[m["id"]]["summary"]),
                    "needs_reply": bool(final[m["id"]]["needs_reply"]),
                    "junk": bool(final[m["id"]]["junk"]),
                    "reply_choices": self.vault.seal(m["user_id"], CHOICES, final[m["id"]]["choices"]),
                    "model": results[m["id"]][1],
                }
                for m in done
            ],
            on_conflict="message_id",
        )
        # The conversation takes the triage of its latest incoming message.
        updates = [m for m in done if latest[m["id"]][0]]
        list(self._pool.map(lambda m: self._update_thread(m, final[m["id"]], latest[m["id"]][1]), updates))
        for m in done:
            self._backoff.succeeded(m["id"])
        log.info("triage batch", messages=len(rows), triaged=len(done), asked=asked, threads=len(updates))
        return len(done)

    def backfill_choices(self, since: str) -> int:
        """Choices for messages triaged before guided drafting, a GROUP at a time and only when there is
        nothing new to triage: recent ones that still need a reply. Only the latest incoming message of
        a conversation is asked about; the rest are marked as looked at. Returns how many were done."""
        rows = self.db.select(
            "message_ai",
            {
                "select": "message_id,messages!inner(id,user_id,account_id,thread_id,provider_message_id,subject,sender_address,"
                "sender_contact_id,list_unsubscribe,sent_at)",
                "needs_reply": "eq.true",
                "junk": "eq.false",
                "reply_choices": "is.null",
                "messages.sent_at": f"gte.{since}",
                **not_in(self._backoff.waiting(time.monotonic()), "message_id"),
                "limit": str(GROUP),
            },
        )
        batch = [r["messages"] for r in rows if isinstance(r.get("messages"), dict)]
        if not batch:
            return 0
        for m in batch:
            self.vault.open_row(m["user_id"], m, [("subject", SUBJECT), ("list_unsubscribe", UNSUBSCRIBE), ("sender_address", ADDRESS)])
        latest = self._latest(batch)
        ask = [m for m in batch if latest[m["id"]][0]]
        found: dict[str, str] = {m["id"]: NO_CHOICES for m in batch if not latest[m["id"]][0]}
        if ask:
            contexts = self._contexts(sorted({m["user_id"] for m in ask}))
            for answers in self._pool.map(lambda chunk: self._ask(contexts[chunk[0]["user_id"]], chunk), self._prepare(ask, contexts)):
                found.update({mid: result["choices"] for mid, (result, _model) in answers.items()})
        by_id = {m["id"]: m for m in batch}
        for mid, choices in found.items():
            self.db.update("message_ai", {"message_id": f"eq.{mid}"}, {"reply_choices": self.vault.seal(by_id[mid]["user_id"], CHOICES, choices)}, minimal=True)
            self._backoff.succeeded(mid)
        log.info("choices backfill", messages=len(batch), asked=len(ask), done=len(found))
        return len(found)

    def _all(self, calls: dict[str, Callable[[], Any]]) -> dict[str, Any]:
        futures = {name: self._pool.submit(fn) for name, fn in calls.items()}
        return {name: f.result() for name, f in futures.items()}

    # What is known --------------------------------------------------------------------------------

    def _contexts(self, user_ids: list[str]) -> dict[str, UserContext]:
        """Each user's context, reread when older than CONTEXT_TTL_S. Runs in the pool: reads in sequence."""
        now = time.monotonic()
        out = {}
        for uid in user_ids:
            cached = self._users.get(uid)
            if cached is None or now - cached[0] > CONTEXT_TTL_S:
                cached = (now, self._user_context(uid))
                self._users[uid] = cached
            out[uid] = cached[1]
        return out

    def _user_context(self, user_id: str) -> UserContext:
        profile = self.db.first("profiles", {"select": "about,important_people", "user_id": f"eq.{user_id}"}) or {}
        rules = self.db.select("priority_rules", {"select": "kind,target", "user_id": f"eq.{user_id}"})
        unsubs = self.db.select("unsubscribes", {"select": "sender_address", "user_id": f"eq.{user_id}"})
        accounts = self.db.select("accounts", {"select": "id", "user_id": f"eq.{user_id}"})
        feedback = self.db.select(
            "feedback",
            {"select": "value,threads(subject)", "user_id": f"eq.{user_id}", "order": "created_at.desc", "limit": "20"},
        )
        corrections = [
            f'"{self.vault.open(user_id, SUBJECT, (f.get("threads") or {}).get("subject")) or "(no subject)"}" marked {f["value"].replace("_", " ")}'
            for f in feedback
        ]
        return UserContext(
            about=profile.get("about") or "",
            important_people=profile.get("important_people") or "",
            always=[self.vault.open(user_id, ADDRESS, r["target"]) or "" for r in rules if r["kind"] == "always_important"],
            never=[self.vault.open(user_id, ADDRESS, r["target"]) or "" for r in rules if r["kind"] == "never_important"],
            unsubscribed={(self.vault.open(user_id, ADDRESS, u["sender_address"]) or "").lower() for u in unsubs},
            corrections=corrections,
            accounts=[a["id"] for a in accounts],
        )

    def _latest(self, batch: list[dict[str, Any]]) -> dict[str, tuple[bool, bool]]:
        """For each message: (latest incoming in its conversation, conversation waiting on them). One read
        for the batch, and two per conversation only for messages that read could not settle."""
        since = min(m["sent_at"] for m in batch)
        rows = self.db.select(
            "messages",
            {
                "select": "id,thread_id,direction",
                "thread_id": in_list(sorted({m["thread_id"] for m in batch})),
                "sent_at": f"gte.{since}",
                "order": "sent_at.desc,id.desc",
                "limit": str(LATEST_ROWS),
            },
        )
        out: dict[str, tuple[bool, bool]] = {}
        decided_all = latest_incoming(rows, batch)
        for m in batch:
            decided = decided_all[m["id"]]
            if decided is None:
                latest_in = self.db.first(
                    "messages", {"select": "id", "thread_id": f"eq.{m['thread_id']}", "direction": "eq.inbound", "order": "sent_at.desc,id.desc"}
                )
                latest_any = self.db.first("messages", {"select": "direction", "thread_id": f"eq.{m['thread_id']}", "order": "sent_at.desc,id.desc"})
                decided = (bool(latest_in) and latest_in["id"] == m["id"], bool(latest_any) and latest_any["direction"] == "inbound")
            out[m["id"]] = decided
        return out

    def _twins(self, messages: list[dict[str, Any]], contexts: dict[str, UserContext]) -> dict[tuple[str, str], tuple[dict[str, Any], str | None]]:
        """Triage already done for the same email (Message-ID) in another of the user's accounts."""
        users = sorted({m["user_id"] for m in messages if len(contexts[m["user_id"]].accounts) > 1 and m.get("provider_message_id")})
        if not users:
            return {}
        ids = sorted({m["provider_message_id"] for m in messages if m["user_id"] in users and m.get("provider_message_id")})
        accounts = sorted({a for u in users for a in contexts[u].accounts})
        rows = self.db.select(
            "messages",
            {
                "select": "user_id,provider_message_id,message_ai!inner(priority,category,summary,needs_reply,junk,reply_choices,model)",
                "account_id": in_list(accounts),  # with the Message-ID, this is the (account_id, provider_message_id) index
                "provider_message_id": in_list(ids),
                "direction": "eq.inbound",
                "limit": "200",
            },
        )
        out = {}
        for r in rows:
            ai = r.get("message_ai")
            ai = ai[0] if isinstance(ai, list) and ai else ai
            if r["user_id"] in users and isinstance(ai, dict):
                copied = {k: ai[k] for k in ("priority", "category", "summary", "needs_reply", "junk")}
                copied["summary"] = self.vault.open(r["user_id"], SUMMARY, copied["summary"])  # sealed again when written
                copied["choices"] = self.vault.open(r["user_id"], CHOICES, ai.get("reply_choices"))
                out[(r["user_id"], r["provider_message_id"])] = (copied, ai.get("model"))
        return out

    # Asking the model -----------------------------------------------------------------------------

    def _prepare(self, ask: list[dict[str, Any]], contexts: dict[str, UserContext]) -> list[list[dict[str, Any]]]:
        """Bodies, senders' contacts and who you have written to, for the messages the model is asked about,
        then the groups to send. Adds name, relationship, known and body to each message."""
        contact_ids = sorted({m["sender_contact_id"] for m in ask if m.get("sender_contact_id")})
        found = self._all(
            {
                "bodies": lambda: self.db.select("messages", {"select": "id,body_text,body_html", "id": in_list([m["id"] for m in ask])}),
                "contacts": lambda: self.db.select("contacts", {"select": "id,display_name,relationship", "id": in_list(contact_ids)}) if contact_ids else [],
                "known": lambda: self._known_senders(contact_ids),
            }
        )
        bodies = {b["id"]: b for b in found["bodies"]}
        contacts = {c["id"]: c for c in found["contacts"]}
        for m in ask:
            contact = contacts.get(m.get("sender_contact_id") or "") or {}
            body = self.vault.open_row(m["user_id"], dict(bodies.get(m["id"]) or {}), [("body_text", BODY), ("body_html", HTML)])
            m["_email"] = {
                "name": contact.get("display_name") or "",
                "sender": (m.get("sender_address") or "").lower(),
                "relationship": contact.get("relationship") or "",
                "known": m.get("sender_contact_id") in found["known"],
                "bulk": bool(m.get("list_unsubscribe")),
                "subject": m.get("subject") or "",
                "sent": m.get("sent_at"),
                "body": clean(body.get("body_text"), body.get("body_html"), limit=BODY_CHARS),
            }
        return groups(ask)

    def _known_senders(self, contact_ids: list[str]) -> set[str]:
        """The contacts they have written to before, a strong sign the mail is personal: contacts in a
        conversation where they sent something."""
        if not contact_ids:
            return set()
        parts = self.db.select("thread_participants", {"select": "thread_id,contact_id", "contact_id": in_list(contact_ids), "limit": "2000"})
        threads = sorted({p["thread_id"] for p in parts})
        if not threads:
            return set()
        replied: set[str] = set()
        for i in range(0, len(threads), 100):
            sent = self.db.select("messages", {"select": "thread_id", "thread_id": in_list(threads[i : i + 100]), "direction": "eq.outbound", "limit": "1000"})
            replied.update(s["thread_id"] for s in sent)
        return {p["contact_id"] for p in parts if p["thread_id"] in replied}

    def _ask(self, ctx: UserContext, chunk: list[dict[str, Any]]) -> dict[str, tuple[dict[str, Any], str | None]]:
        """The model's results by message id for one group (one user and account). An email it would
        not answer in a group is asked about on its own, so it cannot hold the others up."""
        first = chunk[0]
        threads = {m["thread_id"] for m in chunk}
        usage = UsageContext(first["user_id"], "triage", first["account_id"], first["thread_id"] if len(threads) == 1 else None)
        try:
            result = self.gemini.json(
                self.model,
                SYSTEM,
                triage_prompt(ctx, [m["_email"] for m in chunk]),
                SCHEMA,
                usage,
                thinking="minimal",
                max_output=2048 + 256 * len(chunk),  # each answer is about 60 tokens; this only stops a runaway
            )
        except GeminiError as err:
            if len(chunk) > 1 and err.status in (None, 400):
                return {k: v for m in chunk for k, v in self._ask(ctx, [m]).items()}
            self._failed(chunk, err.status)
            return {}
        got = read_results(result, len(chunk))
        out = {m["id"]: (got[i], self.model) for i, m in enumerate(chunk, 1) if i in got}
        missing = [m for m in chunk if m["id"] not in out]
        if missing and len(chunk) > 1:
            for m in missing:
                out.update(self._ask(ctx, [m]))
        elif missing:
            self._failed(missing, None)
        return out

    def _failed(self, chunk: list[dict[str, Any]], status: int | None) -> None:
        now = time.monotonic()
        for m in chunk:
            failures = self._backoff.failed(m["id"], now)
            log.warn("triage failed", message=m["id"], status=status, failures=failures)

    def _update_thread(self, m: dict[str, Any], result: dict[str, Any], waiting_on_them: bool) -> None:
        self.db.update(
            "threads",
            {"id": f"eq.{m['thread_id']}"},
            {
                "priority": result["priority"],
                "category": result["category"],
                "summary": self.vault.seal(m["user_id"], SUMMARY, result["summary"]),
                "needs_reply": bool(result["needs_reply"]) and waiting_on_them,
                "junk": bool(result["junk"]),
            },
            minimal=True,
        )
