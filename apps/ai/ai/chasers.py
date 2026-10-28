"""Conversations waiting on the other person. When you wrote last in a one-to-one conversation more than
a day ago, your last message (with the one before it) is read once to say whether it expects an answer: a question, a request, a proposal waiting on a yes. Thanks, "see you then" and
messages that only tell them something do not. The result goes in public.follow_ups, which the app's
Waiting filter reads; Draft Follow-Up then writes the nudge (drafts.py, when the last message is yours).

Each message is read once: a row keeps the message it was about, and a newer message of yours is read
again. On ten real conversations the fast model called none of them waiting, sent documents and a
proposed meeting time included; the full model got those right, and once per message costs little.
Only counts are logged, never what was said."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

from . import log
from .fields import BODY, HTML
from .gemini import Gemini, GeminiError, UsageContext
from .supabase import Supabase, in_list
from .text import UNTRUSTED, clean
from .vault import Vault

MIN_AGE = timedelta(days=1)  # read a day in, so the Waiting filter (two days) is ready when it is due
MAX_AGE = timedelta(days=30)
PER_RUN = 40
THREADS = 80  # looked at per run, each with its last few messages
BATCH = 10
MESSAGE_CHARS = 500
CHASER_MAX_OUTPUT = 1024  # ten short answers; the schema is a list of id and a boolean

SYSTEM = """You read the end of some conversations. In each, the person you work for wrote the last message.
For each conversation, say whether their last message expects an answer from the other person.

Yes: a question, a request, a proposal, offer or suggested time waiting on a yes or no, documents or
work sent for them to look at or act on (an application, a quote, a CV), or a reminder about something
still owed.
No: thanks, an acknowledgement, a goodbye or "see you then", an answer that closes the topic, or a
message that only gives information and asks for nothing.""" + UNTRUSTED

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"id": {"type": "string", "description": "The conversation's number, such as 1."}, "expects_reply": {"type": "boolean"}},
                "required": ["id", "expects_reply"],
            },
        }
    },
    "required": ["items"],
}


def build_prompt(cases: list[tuple[str, str, str]]) -> str:
    """cases: (id, the message before yours or "", your last message)."""
    out = []
    for cid, before, mine in cases:
        out.append(f"Conversation {cid}:")
        if before:
            out.append(f"--- Them:\n{before}")
        out.append(f"--- Me (last):\n{mine}\n")
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


class Chasers:
    def __init__(self, db: Supabase, gemini: Gemini, model: str, vault: Vault | None = None):
        self.db = db
        self.gemini = gemini
        self.model = model
        self.vault = vault or Vault(db)

    def run_once(self) -> int:
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
        ids = [t["id"] for t in threads]
        seen = {k: r["message_id"] for k, r in checked.items()}
        messages = self.db.select(
            "messages",
            {"select": "id,user_id,thread_id,direction,body_text,body_html,sent_at", "thread_id": in_list(ids), "order": "sent_at.desc", "limit": "1000"},
        )
        owner = {t["id"]: t["user_id"] for t in threads}
        todo = [(thread, pair) for thread, pair in latest_per_thread(messages).items() if seen.get(thread) != pair[1]["id"]][:PER_RUN]
        done = 0
        by_user: dict[str, list[tuple[str, tuple[dict[str, Any] | None, dict[str, Any]]]]] = {}
        for thread, pair in todo:
            by_user.setdefault(owner[thread], []).append((thread, pair))
        for user, items in by_user.items():
            for i in range(0, len(items), BATCH):
                done += self._check(user, items[i : i + BATCH])
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
            result = self.gemini.json(self.model, SYSTEM, build_prompt(cases), SCHEMA, UsageContext(user, "triage"), temperature=0, thinking="low", attempts=2, max_output=CHASER_MAX_OUTPUT)
        except GeminiError as err:
            log.warn("follow-ups not checked", status=err.status)
            return 0
        # The number alone: the model sometimes answers "Conversation 1".
        answers = {re.sub(r"\D", "", str(a.get("id"))): bool(a.get("expects_reply")) for a in result.get("items") or [] if isinstance(a, dict)}
        return self._save(user, items, {**answers, **{k: False for k in quiet}})

    def _save(self, user: str, items: list[tuple[str, tuple[dict[str, Any] | None, dict[str, Any]]]], answers: dict[str, bool]) -> int:
        rows = [
            {"thread_id": thread, "user_id": user, "message_id": mine["id"], "expects_reply": answers[str(n + 1)], "checked_at": datetime.now(timezone.utc).isoformat()}
            for n, (thread, (_, mine)) in enumerate(items)
            if str(n + 1) in answers
        ]
        if rows:
            self.db.upsert("follow_ups", rows, on_conflict="thread_id")
        return len(rows)
