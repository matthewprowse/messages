"""Embeddings: a 768 number fingerprint of what each email says, so drafts can find how you answered
emails like the one in front of you (public.similar_replies). Only incoming messages you have replied to
are embedded: similar_replies searches what you received and returns it only with your reply, which it
reads as text, so a vector for mail nobody answered is never used. The database trigger queues a
message when its reply is stored (20261027100100_embed_replied_mail_only). The mail being drafted
for is embedded on the spot (for_message). The newest is embedded first, then older mail a batch at
a time, so the backfill never floods the API or the database.

Vectors live in public.message_embeddings, not on messages: messages is sent to open browsers by
Realtime on every change, and the vector would go with it. A database trigger adds a row with no
vector for each incoming message, and that is the queue worked here. Until that migration
(20261024110000_ai_message_embeddings) is applied, the older messages.embedding column is used."""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from . import log
from .fields import BODY, HTML, SUBJECT
from .gemini import Gemini, GeminiError, UsageContext
from .retry import Backoff, not_in
from .supabase import Supabase, missing_relation
from .text import clean
from .vault import Vault

BATCH = 48  # one embedding request (the API takes up to 100 texts) and one write for the lot
TEXT_CHARS = 2000
LEGACY_RECHECK_S = 600  # without the new table, look for it again this often
# Same prefix for every message: gemini-embedding-2 wants the task in the text, and similarity is symmetric.
PREFIX = "task: sentence similarity | query: "


def embed_text(subject: str | None, body_text: str | None, body_html: str | None) -> str:
    """Subject and the new writing only, without quoted history, so a reply is compared on what it says."""
    body = clean(body_text, body_html, limit=TEXT_CHARS)
    parts = [p for p in [(subject or "").strip(), body] if p]
    return PREFIX + ("\n\n".join(parts) if parts else "(no text)")


def vector_literal(values: list[float]) -> str:
    """pgvector's text form, which PostgREST accepts for a vector column."""
    return "[" + ",".join(f"{v:.6f}" for v in values) + "]"


def embedding_rows(messages: list[dict[str, Any]], vectors: list[list[float]]) -> list[dict[str, Any]]:
    """message_embeddings rows for one upsert, all with the same keys as PostgREST needs."""
    return [
        {"message_id": m["id"], "user_id": m["user_id"], "sent_at": m["sent_at"], "embedding": vector_literal(v)}
        for m, v in zip(messages, vectors)
    ]


def queue_row(row: dict[str, Any]) -> dict[str, Any]:
    """A message_embeddings queue row with its message embedded, flattened to look like a messages row."""
    return {"id": row["message_id"], "user_id": row["user_id"], "sent_at": row["sent_at"], **(row.get("messages") or {})}


class Embeddings:
    def __init__(self, db: Supabase, gemini: Gemini, model: str, vault: Vault | None = None):
        self.db = db
        self.gemini = gemini
        self.model = model
        self.vault = vault or Vault(db)  # without one, plaintext passes through
        self._pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="embed-write")
        self._backoff = Backoff()
        self._legacy_until = 0.0  # while in the future, vectors are read and written on messages.embedding

    def run_once(self) -> int:
        """Embeds one batch of incoming messages, newest first, for any user. Returns how many were embedded."""
        rows = [self.vault.open_row(r["user_id"], r, [("subject", SUBJECT), ("body_text", BODY), ("body_html", HTML)]) for r in self._pending()]
        if not rows:
            return 0
        done = 0
        by_user: dict[str, list[dict[str, Any]]] = {}
        for r in rows:
            by_user.setdefault(r["user_id"], []).append(r)
        for user_id, batch in by_user.items():
            try:
                vectors = self.gemini.embed(
                    self.model, [embed_text(r.get("subject"), r.get("body_text"), r.get("body_html")) for r in batch], UsageContext(user_id, "learn")
                )
            except GeminiError as err:
                # The whole batch waits, so a message the model refuses does not hold the backfill up.
                now = time.monotonic()
                for r in batch:
                    self._backoff.failed(r["id"], now)
                log.warn("embedding failed", user=user_id, messages=len(batch), status=err.status)
                continue
            saved = self._save(batch, vectors)
            for r in batch:
                if r["id"] in saved:
                    done += 1
                    self._backoff.succeeded(r["id"])
                else:
                    self._backoff.failed(r["id"], time.monotonic())
        log.info("messages embedded", messages=done)
        return done

    def for_message(self, message: dict[str, Any], user_id: str, account_id: str | None, thread_id: str | None) -> list[float] | None:
        """The vector for one message, embedding and saving it now when the backfill has not reached it.
        message needs id and sent_at to be saved, and its subject and body already opened."""
        try:
            [vector] = self.gemini.embed(
                self.model,
                [embed_text(message.get("subject"), message.get("body_text"), message.get("body_html"))],
                UsageContext(user_id, "learn", account_id, thread_id),
            )
        except GeminiError as err:
            log.warn("embedding failed", message=message.get("id"), status=err.status)
            return None
        if message.get("id") and message.get("sent_at"):
            self._save([{**message, "user_id": user_id}], [vector])
        return vector

    # Storage --------------------------------------------------------------------------------------

    def _legacy(self) -> bool:
        return time.monotonic() < self._legacy_until

    def _went_legacy(self, err: Exception) -> bool:
        """True when err says message_embeddings is not there yet, switching to messages.embedding for a while."""
        if not missing_relation(err):
            return False
        self._legacy_until = time.monotonic() + LEGACY_RECHECK_S
        log.warn("message_embeddings not found, using messages.embedding", code=getattr(err, "code", None))
        return True

    def _pending(self) -> list[dict[str, Any]]:
        skip = self._backoff.waiting(time.monotonic())
        if not self._legacy():
            try:
                rows = self.db.select(
                    "message_embeddings",
                    {
                        "select": "message_id,user_id,sent_at,messages(account_id,subject,body_text,body_html)",
                        "embedding": "is.null",
                        "order": "sent_at.desc",
                        "limit": str(BATCH),
                        **not_in(skip, "message_id"),
                    },
                )
                return [queue_row(r) for r in rows]
            except Exception as err:
                if not self._went_legacy(err):
                    raise
        try:
            return self.db.select(
                "messages",
                {
                    "select": "id,user_id,account_id,sent_at,subject,body_text,body_html",
                    "direction": "eq.inbound",
                    "embedding": "is.null",
                    "order": "sent_at.desc",
                    "limit": str(BATCH),
                    **not_in(skip),
                },
            )
        except Exception as err:
            if missing_relation(err):  # the migration ran meanwhile: use the new table next time
                self._legacy_until = 0.0
                return []
            raise

    def _save(self, messages: list[dict[str, Any]], vectors: list[list[float]]) -> set[str]:
        """Saves the vectors, all in one request. Returns the ids saved."""
        if not self._legacy():
            try:
                self.db.upsert("message_embeddings", embedding_rows(messages, vectors), on_conflict="message_id")
                return {m["id"] for m in messages}
            except Exception as err:
                if not self._went_legacy(err):
                    log.warn("embeddings not saved", messages=len(messages), code=log.code_of(err))
                    return set()
        writes = [self._pool.submit(self._save_legacy, m["id"], v) for m, v in zip(messages, vectors)]
        return {m["id"] for m, w in zip(messages, writes) if w.result()}

    def _save_legacy(self, message_id: str, vector: list[float]) -> bool:
        try:
            self.db.update("messages", {"id": f"eq.{message_id}"}, {"embedding": vector_literal(vector)}, minimal=True)
            return True
        except Exception as err:
            log.warn("embedding not saved", message=message_id, code=log.code_of(err))
            return False
