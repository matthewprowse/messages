"""Document cards: reads a PDF or an image that looks like a document and keeps a card on the attachment, sealed:
type (invoice, quote, contract, ID, statement, proof of payment, other), counterparty, amount and currency (ZAR by
default), due date, reference and a one-line summary. documents_card.py holds the prompt and the checks.

Two ways in, both counted against the Document Cards share of fair usage (feature "documents"):
  - A request: the app inserts a row in public.document_reads when someone opens a file and asks. These are answered first.
  - A pass over files from people in the contacts list: PDFs, and images whose names look like documents, from
    a person's own contacts and never from bulk mail, in the last two weeks. Photos and chat images wait to be asked for.
A per-person daily cap bounds both (AUTO_CAP for the pass, TOTAL_CAP with requests). The cheapest model that reads PDFs
does the reading; a PDF goes up through the Files API (gemini_files.py) and is deleted straight after, an image goes inline.

Only counts and ids are logged, never what a document said."""

from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from . import log
from .documents_card import MAX_FILE_BYTES, MIN_FILE_BYTES, PDF, SCHEMA, SYSTEM, check_answer, mime_of, prompt, worth_reading
from .fields import ADDRESS, ATTACHMENT_DATA, DOC_CARD, FILENAME
from .gemini import Gemini, GeminiError, UsageContext
from .poll import Backoff
from .retry import billing_paused
from .supabase import Supabase, missing_relation
from .vault import Vault

BUCKET = "attachments"
PER_RUN = 3  # a PDF read takes several seconds, so a few at a time
EVERY_S = 10  # how soon after the last file it looks again while there is work
IDLE_S = 90  # and how far an idle worker backs off
STALE = timedelta(minutes=5)  # a claimed request nobody finished (the worker stopped) is picked up again after this
RECENT = timedelta(days=14)  # the pass leaves older files alone: reading a backlog is for the person to ask
CANDIDATES = 30  # files looked at per pass before the name check
AUTO_CAP = 15  # files read by the pass for one person in a UTC day
TOTAL_CAP = 40  # files read for one person in a UTC day, requests included
TRIES = 2  # reads that may fail for a file before it is given up on
PAUSE_S = 3600  # a person whose share is used up is left alone this long
MAX_OUTPUT = 600  # tokens: a card is a few short lines
ATTACHMENT_COLUMNS = "id,user_id,filename,mime_type,size_bytes,storage_path,doc_state"
MESSAGE_COLUMNS = "account_id,thread_id,sender_address"

PAUSED = "Document cards are paused until the 1st. The file is still here."
AI_PAUSED = "AI is paused for now. Try again later."  # Gemini billing is paused or the budget cannot be read: not the person's share
FAILED = "This file could not be read. Try again."
CAPPED = "You have read a lot of documents today. Try again tomorrow."
UNREADABLE = {
    "missing": "This file is not stored here, so it cannot be read.",
    "type": "Only PDFs and pictures can be read.",
    "size": "This file is too large or too small to read.",
}


def day_start(now: datetime) -> str:
    """Midnight UTC of the day, as the cap counts from."""
    return now.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()


class Documents:
    def __init__(self, db: Supabase, gemini: Gemini, model: str, vault: Vault):
        self.db = db
        self.gemini = gemini
        self.model = model
        self.vault = vault
        self._paused: dict[str, float] = {}  # user id -> monotonic time their share is looked at again
        self._tries: dict[str, int] = {}  # attachment id -> failed reads

    def run_once(self) -> int:
        """Answers open requests, then spends what is left of PER_RUN on the pass. Returns how many files it worked on."""
        done = self._requests()
        if done < PER_RUN:
            done += self._pass(PER_RUN - done)
        return done

    def loop(self, stop: threading.Event) -> None:
        """The thread's loop: quick while there is work, backing off to IDLE_S when there is none. A missing table
        (the migration is not applied yet) waits ten minutes."""
        wait = Backoff(EVERY_S, IDLE_S)
        while not stop.is_set():
            found = True
            try:
                found = self.run_once() > 0
            except Exception as err:
                if missing_relation(err):
                    stop.wait(600)
                    continue
                log.error("documents loop failed", code=log.code_of(err))
            stop.wait(wait.next(found))

    # Requests

    def _requests(self) -> int:
        stale = (datetime.now(timezone.utc) - STALE).isoformat()
        rows = self.db.select(
            "document_reads",
            {"select": "attachment_id,user_id", "error": "is.null", "or": f"(claimed_at.is.null,claimed_at.lt.{stale})", "order": "created_at.asc", "limit": str(PER_RUN)},
        )
        done = 0
        for r in rows:
            # One conditional update, so two workers cannot both take a request.
            claimed = self.db.update(
                "document_reads",
                {"attachment_id": f"eq.{r['attachment_id']}", "or": f"(claimed_at.is.null,claimed_at.lt.{stale})"},
                {"claimed_at": datetime.now(timezone.utc).isoformat()},
            )
            if not claimed:
                continue
            done += 1
            try:
                self._request(r["attachment_id"], r["user_id"])
            except Exception as err:
                log.warn("document read failed", code=log.code_of(err))
                self._fail(r["attachment_id"], FAILED)
        return done

    def _request(self, attachment_id: str, user_id: str) -> None:
        a = self.db.first("attachments", {"select": f"{ATTACHMENT_COLUMNS},messages({MESSAGE_COLUMNS})", "id": f"eq.{attachment_id}"})
        if not a or a["user_id"] != user_id or not a.get("storage_path"):
            self._fail(attachment_id, UNREADABLE["missing"])
            return
        if a.get("doc_state") == "done":  # already read: no second paid call
            self.db.delete("document_reads", {"attachment_id": f"eq.{attachment_id}"})
            return
        if self._read_today(user_id) >= TOTAL_CAP:
            self._fail(attachment_id, CAPPED)
            return
        if self.gemini.billing_blocked():  # known before downloading anything: say so now rather than leave the page waiting
            self._fail(attachment_id, AI_PAUSED)
            return
        self._open(user_id, a)
        mime = mime_of(a.get("mime_type"), a.get("filename"))
        size = a.get("size_bytes") or 0
        if mime is None:
            self._fail(attachment_id, UNREADABLE["type"])
        elif size > MAX_FILE_BYTES:  # a person asked, so even a small file is tried
            self._fail(attachment_id, UNREADABLE["size"])
        else:
            outcome = self._read(a, user_id, mime, "request")
            # Someone is watching the page: a pause is said plainly (Retry is there) instead of held in silence until it ends.
            if outcome in ("held", "unknown"):
                self._fail(attachment_id, AI_PAUSED)
            elif outcome == "budget":
                self._fail(attachment_id, PAUSED)
            elif outcome == "failed":
                self._fail(attachment_id, FAILED)
            else:
                self.db.delete("document_reads", {"attachment_id": f"eq.{attachment_id}"})

    # The pass over files from contacts

    def _pass(self, room: int) -> int:
        if self.gemini.billing_blocked():
            return 0
        now = datetime.now(timezone.utc)
        rows = self.db.select(
            "attachments",
            {
                "select": f"{ATTACHMENT_COLUMNS},messages!inner({MESSAGE_COLUMNS},sender_contact_id,is_bulk,direction)",
                "doc_state": "is.null",
                "hidden": "eq.false",
                "is_sticker": "eq.false",
                "storage_path": "not.is.null",
                "kind": "in.(pdf,image)",
                "created_at": f"gte.{(now - RECENT).isoformat()}",
                "and": f"(size_bytes.gte.{MIN_FILE_BYTES},size_bytes.lte.{MAX_FILE_BYTES})",
                "messages.direction": "eq.inbound",
                "messages.is_bulk": "eq.false",
                "messages.sender_contact_id": "not.is.null",
                "order": "created_at.desc",
                "limit": str(CANDIDATES),
            },
        )
        done = 0
        reads: dict[str, int] = {}
        for a in rows:
            if done >= room:
                break
            user_id = a["user_id"]
            if self._paused.get(user_id, 0.0) > time.monotonic():
                continue
            if user_id not in reads:
                reads[user_id] = self._read_today(user_id)
            if reads[user_id] >= AUTO_CAP:
                continue
            self._open(user_id, a)
            mime = mime_of(a.get("mime_type"), a.get("filename"))
            if not worth_reading(a.get("filename"), mime, a.get("size_bytes")):
                # Not looked at again by the pass; a request can still read it. No read time, so it is not counted in the cap.
                self.db.update("attachments", {"id": f"eq.{a['id']}"}, {"doc_state": "none"}, minimal=True)
                continue
            try:
                outcome = self._read(a, user_id, mime or PDF, "auto")
            except Exception as err:
                self._failed(a["id"], err)
                continue
            if outcome in ("held", "unknown"):  # nobody is waiting on the pass: it tries again once the pause is over
                return done
            if outcome == "budget":
                self._paused[user_id] = time.monotonic() + PAUSE_S
                continue
            if outcome == "failed":
                self._failed(a["id"], None)
                continue
            reads[user_id] += 1
            done += 1
        if done:
            log.info("document cards made", count=done)
        return done

    def _failed(self, attachment_id: str, err: Exception | None) -> None:
        tries = self._tries.get(attachment_id, 0) + 1
        self._tries[attachment_id] = tries
        log.warn("document not read", tries=tries, code=log.code_of(err) if err else "gemini")
        if tries >= TRIES:
            self.db.update("attachments", {"id": f"eq.{attachment_id}"}, {"doc_state": "failed"}, minimal=True)
            self._tries.pop(attachment_id, None)

    # Reading one file

    def _read_today(self, user_id: str) -> int:
        """How many files were read for this person since midnight UTC (the cap counts what was read, not what was skipped)."""
        return self.db.count("attachments", {"user_id": f"eq.{user_id}", "doc_read_at": f"gte.{day_start(datetime.now(timezone.utc))}"})

    def _open(self, user_id: str, a: dict[str, Any]) -> None:
        self.vault.open_row(user_id, a, [("filename", FILENAME)])
        m = a.get("messages")
        if isinstance(m, dict) and "sender_address" in m:
            self.vault.open_row(user_id, m, [("sender_address", ADDRESS)])

    def _read(self, a: dict[str, Any], user_id: str, mime: str, by: str) -> str:
        """Reads the file and stores the card. Returns "done" (a card or a note that it is no document), "held" (billing is
        paused, nothing stored), "budget" (the share is used up), "unknown" (the budget could not be read) or "failed"
        (the model could not answer)."""
        data = self.db.download(BUCKET, a["storage_path"])
        opened = self.vault.open_bytes(user_id, ATTACHMENT_DATA, data, f"{BUCKET}/{a['storage_path']}")
        if opened is None:
            raise OSError("file could not be opened")
        if len(opened) > MAX_FILE_BYTES:
            self._store(a["id"], user_id, None, by)
            return "done"
        m = a.get("messages") if isinstance(a.get("messages"), dict) else {}
        usage = UsageContext(user_id, "documents", m.get("account_id"), m.get("thread_id"))
        text = prompt(m.get("sender_address") or "", a.get("filename") or "")
        uploaded: str | None = None
        try:
            if mime == PDF:
                uploaded, uri = self.gemini.upload_file(opened, mime)
                answer = self.gemini.json(self.model, SYSTEM, text, SCHEMA, usage, thinking="minimal", max_output=MAX_OUTPUT, attempts=2, timeout=120, file=(uri, mime))
            else:
                answer = self.gemini.json(self.model, SYSTEM, text, SCHEMA, usage, thinking="minimal", max_output=MAX_OUTPUT, attempts=2, timeout=120, image=(opened, mime))
        except GeminiError as err:
            if billing_paused(err):
                log.warn("document read held")
                return "held"
            if "budget_unknown" in str(err):
                return "unknown"
            return "budget" if "budget_" in str(err) else "failed"
        finally:
            if uploaded:
                self.gemini.delete_file(uploaded)
        self._store(a["id"], user_id, check_answer(answer), by)
        self._tries.pop(a["id"], None)
        return "done"

    def _store(self, attachment_id: str, user_id: str, card: dict[str, Any] | None, by: str) -> None:
        patch: dict[str, Any] = {"doc_state": "done" if card else "none", "doc_read_at": datetime.now(timezone.utc).isoformat(), "doc_by": by}
        patch["doc_card"] = self.vault.seal(user_id, DOC_CARD, json.dumps(card)) if card else None
        self.db.update("attachments", {"id": f"eq.{attachment_id}"}, patch, minimal=True)

    def _fail(self, attachment_id: str, reason: str) -> None:
        """Keeps the request with its error, so the app can say why and offer Retry, and lets go of the claim."""
        self.db.update("document_reads", {"attachment_id": f"eq.{attachment_id}"}, {"error": reason, "claimed_at": None}, minimal=True)

