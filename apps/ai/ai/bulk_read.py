"""Readable Bulk Email: a short readable version of a newsletter, marketing or notification email, made only when
someone opens it. The app inserts a row in public.bulk_reads; this claims it, reads the email's stored text, asks the
fast model for a summary, a few key points and labelled links (bulk_read_text.py holds the prompt and the checks), seals
the result on message_ai.bulk_read and deletes the request. A request that cannot be answered keeps a short error the
app shows with Retry. Nothing is made on arrival, so mail that is never opened costs nothing.

Bulk mail older than 30 days is already shortened to a preview (messages.body_shrunk_at), so it is not read. Only counts
and ids are logged, never what an email said."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from . import log
from .bulk_read_text import SCHEMA, SYSTEM, check_answer, extract_links, html_text, prompt, readable_text
from .fields import ADDRESS, BODY, BULK_READ, HTML, SUBJECT
from .gemini import Gemini, GeminiError, UsageContext
from .retry import billing_paused
from .supabase import Supabase
from .vault import Vault

PER_RUN = 4
STALE = timedelta(minutes=5)  # a claimed request nobody finished (the worker stopped) is picked up again after this
MAX_OUTPUT = 700  # tokens: a summary, five points and four labels

PAUSED = "Readable versions are paused until the 1st. The original is still here."
FAILED = "This email could not be read. Try again."
UNREADABLE = {
    "shrunk": "This email is too old to read here. Use View Original.",
    "empty": "This email has no text to read. Use View Original.",
    "not_bulk": "Only newsletters and automated mail get a readable version.",
    "not_sorted": "This email is still being sorted. Try again in a moment.",
    "nothing": "Nothing in this email could be checked. Use View Original.",
}


def has_result(message_ai: Any) -> bool:
    """Whether message_ai already holds a readable version (the embed comes back as one row or a list of one)."""
    row = message_ai[0] if isinstance(message_ai, list) and message_ai else message_ai
    return isinstance(row, dict) and bool(row.get("bulk_read"))


class BulkRead:
    def __init__(self, db: Supabase, gemini: Gemini, model: str, vault: Vault):
        self.db = db
        self.gemini = gemini
        self.model = model
        self.vault = vault

    def run_once(self) -> int:
        """Answers the open requests, at most PER_RUN. Returns how many it claimed."""
        stale = (datetime.now(timezone.utc) - STALE).isoformat()
        rows = self.db.select(
            "bulk_reads",
            {"select": "message_id,user_id", "error": "is.null", "or": f"(claimed_at.is.null,claimed_at.lt.{stale})", "order": "created_at.asc", "limit": str(PER_RUN)},
        )
        done = 0
        for r in rows:
            # The claim is one conditional update, so two workers cannot both take a request.
            claimed = self.db.update(
                "bulk_reads",
                {"message_id": f"eq.{r['message_id']}", "or": f"(claimed_at.is.null,claimed_at.lt.{stale})"},
                {"claimed_at": datetime.now(timezone.utc).isoformat()},
            )
            if not claimed:
                continue
            done += 1
            try:
                self._answer(r["message_id"], r["user_id"])
            except Exception as err:
                log.warn("bulk read failed", code=log.code_of(err))
                self._fail(r["message_id"], FAILED)
        return done

    def _answer(self, message_id: str, user_id: str) -> None:
        m = self.db.first(
            "messages",
            {
                "select": "id,user_id,account_id,thread_id,subject,sender_address,is_bulk,body_text,body_html,body_shrunk_at,message_ai(message_id,bulk_read)",
                "id": f"eq.{message_id}",
            },
        )
        if not m or m["user_id"] != user_id:
            self._fail(message_id, UNREADABLE["nothing"])
            return
        if not m.get("is_bulk"):
            self._fail(message_id, UNREADABLE["not_bulk"])
        elif m.get("body_shrunk_at"):
            self._fail(message_id, UNREADABLE["shrunk"])
        elif not m.get("message_ai"):
            self._fail(message_id, UNREADABLE["not_sorted"])
        elif has_result(m["message_ai"]):  # already made (a second request, or a retry after the result was stored): no second paid call
            self.db.delete("bulk_reads", {"message_id": f"eq.{m['id']}"})
        else:
            self._read(m, user_id)

    def _read(self, m: dict[str, Any], user_id: str) -> None:
        self.vault.open_row(user_id, m, [("subject", SUBJECT), ("sender_address", ADDRESS), ("body_text", BODY), ("body_html", HTML)])
        text = m.get("body_text") or ""
        if not text.strip():  # an HTML-only email: its links and figures come from the HTML
            text = html_text(m.get("body_html"))
        links = extract_links(text)
        body = readable_text(text)
        if len(body) < 20:
            self._fail(m["id"], UNREADABLE["empty"])
            return
        usage = UsageContext(user_id, "bulk_read", m["account_id"], m["thread_id"])
        try:
            answer = self.gemini.json(self.model, SYSTEM, prompt(m.get("sender_address") or "", m.get("subject") or "", body, links), SCHEMA, usage, thinking="minimal", max_output=MAX_OUTPUT)
        except GeminiError as err:
            if billing_paused(err):  # no error is set: the claim goes stale (STALE) and the request is read again after the pause
                log.warn("bulk read held")
                return
            self._fail(m["id"], PAUSED if "budget_paused" in str(err) else FAILED)
            return
        result = check_answer(text, links, answer)
        if result is None:
            self._fail(m["id"], UNREADABLE["nothing"])
            return
        self.db.update("message_ai", {"message_id": f"eq.{m['id']}"}, {"bulk_read": self.vault.seal(user_id, BULK_READ, json.dumps(result))}, minimal=True)
        self.db.delete("bulk_reads", {"message_id": f"eq.{m['id']}"})
        log.info("bulk read made", points=len(result["points"]), links=len(result["links"]))

    def _fail(self, message_id: str, reason: str) -> None:
        """Keeps the request with its error, so the app can say why and offer Retry."""
        self.db.update("bulk_reads", {"message_id": f"eq.{message_id}"}, {"error": reason}, minimal=True)
