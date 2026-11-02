"""Conversations waiting on the other person. When you wrote last in a one-to-one conversation more than
a day ago, your last message (with the one before it) is read once to say whether it expects an answer: a question, a request, a proposal waiting on a yes. Thanks, "see you then" and
messages that only tell them something do not. The result goes in public.follow_ups, which the app's
Waiting filter reads; Draft Follow-Up then writes the nudge (drafts.py, when the last message is yours).

Each message is read once: a row keeps the message it was about, and a newer message of yours is read
again. On ten real conversations the fast model called none of them waiting, sent documents and a
proposed meeting time included; the full model got those right, and once per message costs little.
A call pays for its instructions and answer overhead on the full model however few conversations it holds,
and one or two are usually due per run, so a user is asked about once MIN_BATCH are due or the oldest has
waited MAX_HOLD past its due time, then in one call of up to BATCH.

The same call lists the promises in those two messages ("I'll send the quote by Friday", "they will confirm Monday")
for public.commitments (commitments.py), so tracking promises costs no second call. Only counts are logged, never what was said."""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Any

from . import commitments, log
from .fields import BODY, HTML
from .gemini import Gemini, GeminiError, UsageContext
from .supabase import Supabase, in_list
from .text import UNTRUSTED, clean, fenced, new_fence
from .vault import Vault

MIN_AGE = timedelta(days=1)  # read a day in, so the Waiting filter (two days) is ready when it is due
MAX_AGE = timedelta(days=30)
PER_RUN = 40
THREADS = 80  # looked at per run, each with its last few messages
BATCH = 10
PER_THREAD_MESSAGES = 3  # latest_per_thread needs your last message and the one before it, with one to spare
MIN_BATCH = 5  # a user is only asked about when this many are due, or the oldest has waited MAX_HOLD past its due time
MAX_HOLD = timedelta(hours=12)  # still inside the two-day Waiting window: read by about a day and a half
MESSAGE_CHARS = 500
CHASER_MAX_OUTPUT = 2048  # ten answers, each an id and a boolean, and up to three short promises

SYSTEM = """You read the end of some conversations. In each, the person you work for wrote the last message.
For each conversation, say whether their last message expects an answer from the other person.

Yes: a question, a request, a proposal, offer or suggested time waiting on a yes or no, documents or
work sent for them to look at or act on (an application, a quote, a CV), or a reminder about something
still owed.
No: thanks, an acknowledgement, a goodbye or "see you then", an answer that closes the topic, or a
message that only gives information and asks for nothing.

""" + commitments.INSTRUCTIONS + UNTRUSTED

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"id": {"type": "string", "description": "The conversation's number, such as 1."}, "expects_reply": {"type": "boolean"}, "commitments": commitments.SCHEMA},
                "required": ["id", "expects_reply"],
            },
        }
    },
    "required": ["items"],
}


def build_prompt(cases: list[tuple[str, str, str]], fence: str | None = None, today: date | None = None) -> str:
    """cases: (id, the message before yours or "", your last message). Each conversation sits between lines
    carrying a random code (fence), as the system prompt says: the other person's words are data. today lets
    "by Friday" be worked out as a date; it is ours, so it sits outside the fences."""
    fence = fence or new_fence()
    out = [f"Today is {today:%A %Y-%m-%d}.", ""] if today else []
    for cid, before, mine in cases:
        body = (f"--- Them:\n{before}\n" if before else "") + f"--- Me (last):\n{mine}"
        out += [f"Conversation {cid}:", fenced(body, fence), ""]
    return "\n".join(out)


def latest_per_thread(messages: list[dict[str, Any]]) -> dict[str, tuple[dict[str, Any] | None, dict[str, Any]]]:
    """messages newest first -> thread id: (the message before your last one, your last one). Threads whose
    newest message is not yours are left out: they are not waiting on anyone."""
    by_thread: dict[str, list[dict[str, Any]]] = {}
    for m in messages:
        by_thread.setdefault(m["thread_id"], []).append(m)
    out = {}
    for thread, ms in by_thread.items():
        if ms[0]["direction"] != "outbound":
            continue
        before = next((m for m in ms[1:] if m["direction"] == "inbound"), None)
        out[thread] = (before, ms[0])
    return out


def _changed(thread: dict[str, Any], check: dict[str, Any] | None) -> bool:
    """True when the thread has not been checked, or its last message came after the check."""
    if not check or not check.get("checked_at"):
        return True
    try:
        return datetime.fromisoformat(str(thread["last_message_at"])) > datetime.fromisoformat(str(check["checked_at"]))
    except ValueError:
        return True


def batch_ready(last_message_at: list[str], now: datetime) -> bool:
    """Whether enough is due for one user to be worth a call: MIN_BATCH conversations, or the oldest has been
    due (a day after its last message) for MAX_HOLD. last_message_at is that time for each due conversation."""
    if len(last_message_at) >= MIN_BATCH:
        return True
    for value in last_message_at:
        try:
            if now - (datetime.fromisoformat(str(value).replace("Z", "+00:00")) + MIN_AGE) >= MAX_HOLD:
                return True
        except ValueError:
            return True  # an unreadable time is not held back
    return False


class Chasers:
    def __init__(self, db: Supabase, gemini: Gemini, model: str, vault: Vault | None = None):
        self.db = db
        self.gemini = gemini
        self.model = model
        self.vault = vault or Vault(db)

    def run_once(self) -> int:
        done = self._check_waiting()
        try:
            commitments.sweep(self.db, datetime.now(timezone.utc))
        except Exception as err:  # the promises migration may not be applied yet; the Waiting check must not suffer for it
            log.warn("promise sweep failed", code=log.code_of(err))
        return done

    def _check_waiting(self) -> int:
        now = datetime.now(timezone.utc)
        threads = self.db.select(
            "threads",
            {
                "select": "id,user_id,last_message_at",
                "last_from_me": "eq.true",
                "is_group": "eq.false",
                "junk": "eq.false",
                "status": "eq.inbox",
                # A day old at least (and no older than MAX_AGE), in the query so newer threads do not crowd out the due ones.
                "and": f"(last_message_at.gte.{(now - MAX_AGE).isoformat()},last_message_at.lte.{(now - MIN_AGE).isoformat()})",
                "order": "last_message_at.desc",
                "limit": "300",
            },
        )
        if not threads:
            return 0
        checked = {
            r["thread_id"]: r for r in self.db.select("follow_ups", {"select": "thread_id,message_id,checked_at", "thread_id": in_list([t["id"] for t in threads])})
        }
        # Only threads with no check yet, or with a message since the last one: bodies are read for those alone.
        threads = [t for t in threads if _changed(t, checked.get(t["id"]))][:THREADS]
        if not threads:
            return 0
        # Users with too little due are left for a later run before any message is read for them.
        waiting: dict[str, list[str]] = {}
        for t in threads:
            waiting.setdefault(t["user_id"], []).append(t["last_message_at"])
        ready = {u for u, times in waiting.items() if batch_ready(times, now)}
        threads = [t for t in threads if t["user_id"] in ready]
        if not threads:
            return 0
        ids = [t["id"] for t in threads]
        seen = {k: r["message_id"] for k, r in checked.items()}
        # One small read per thread: a single capped read across all of them let a busy thread's history crowd out the
        # latest messages of the ones that had waited longest.
        messages: list[dict[str, Any]] = []
        for thread_id in ids:
            messages += self.db.select(
                "messages",
                {"select": "id,user_id,thread_id,direction,body_text,body_html,sent_at", "thread_id": in_list([thread_id]), "order": "sent_at.desc", "limit": str(PER_THREAD_MESSAGES)},
            )
        owner = {t["id"]: t["user_id"] for t in threads}
        when = {t["id"]: t["last_message_at"] for t in threads}
        todo = [(thread, pair) for thread, pair in latest_per_thread(messages).items() if seen.get(thread) != pair[1]["id"]][:PER_RUN]
        done = 0
        by_user: dict[str, list[tuple[str, tuple[dict[str, Any] | None, dict[str, Any]]]]] = {}
        for thread, pair in todo:
            by_user.setdefault(owner[thread], []).append((thread, pair))
        for user, items in by_user.items():
            if not batch_ready([when[thread] for thread, _ in items], now):  # what is left once answered ones are dropped
                continue
            items.sort(key=lambda item: str(when[item[0]]))  # the longest waiting first
            done += self._check(user, items[:BATCH])  # one call per user per run; the rest next run
        if done:
            log.info("follow-ups checked", count=done)
        return done

    def _check(self, user: str, items: list[tuple[str, tuple[dict[str, Any] | None, dict[str, Any]]]]) -> int:
        cases = []
        quiet = []  # a photo or voice note on its own, with no words to read: noted as not waiting
        for n, (_, (before, mine)) in enumerate(items):
            for m in (before, mine):
                if m:
                    self.vault.open_row(user, m, [("body_text", BODY), ("body_html", HTML)])
            text = lambda m: clean(m.get("body_text"), m.get("body_html"), limit=MESSAGE_CHARS) if m else ""
            if text(mine):
                cases.append((str(n + 1), text(before), text(mine)))
            else:
                quiet.append(str(n + 1))
        if not cases:
            return self._save(user, items, {k: False for k in quiet})
        try:
            result = self.gemini.json(self.model, SYSTEM, build_prompt(cases, today=datetime.now(timezone.utc).date()), SCHEMA, UsageContext(user, "triage"), temperature=0, thinking="low", attempts=2, max_output=CHASER_MAX_OUTPUT)
        except GeminiError as err:
            log.warn("follow-ups not checked", status=err.status)
            return 0
        # The number alone: the model sometimes answers "Conversation 1".
        answers = {re.sub(r"\D", "", str(a.get("id"))): bool(a.get("expects_reply")) for a in result.get("items") or [] if isinstance(a, dict)}
        today = datetime.now(timezone.utc).date()
        promises = {re.sub(r"\D", "", str(a.get("id"))): commitments.clean_commitments(a.get("commitments"), today) for a in result.get("items") or [] if isinstance(a, dict)}
        saved = self._save(user, items, {**answers, **{k: False for k in quiet}})
        self._save_promises(user, items, promises)
        return saved

    def _save_promises(self, user: str, items: list[tuple[str, tuple[dict[str, Any] | None, dict[str, Any]]]], promises: dict[str, list[dict[str, Any]]]) -> None:
        """Stores the promises found. A failure here (the table not there yet) never undoes the follow-up check."""
        rows = []
        for n, (thread, (before, mine)) in enumerate(items):
            rows += commitments.commitment_rows(user, thread, before, mine, promises.get(str(n + 1), []), self.vault)
        if not rows:
            return
        try:
            self.db.upsert("commitments", rows, on_conflict="message_id,seq")
            log.info("promises found", count=len(rows))
        except Exception as err:
            log.warn("promises not saved", code=log.code_of(err))

    def _save(self, user: str, items: list[tuple[str, tuple[dict[str, Any] | None, dict[str, Any]]]], answers: dict[str, bool]) -> int:
        rows = [
            {"thread_id": thread, "user_id": user, "message_id": mine["id"], "expects_reply": answers[str(n + 1)], "checked_at": datetime.now(timezone.utc).isoformat()}
            for n, (thread, (_, mine)) in enumerate(items)
            if str(n + 1) in answers
        ]
        if rows:
            self.db.upsert("follow_ups", rows, on_conflict="thread_id")
        return len(rows)
