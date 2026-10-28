"""Embeddings: a 768 number fingerprint of what each email says, so drafts can find how you answered
emails like the one in front of you (similar.py). Only incoming messages you have replied to
are embedded: the search covers what you received and returns it only with your reply, which is
read as text, so a vector for mail nobody answered is never used. The database trigger queues a
message when its reply is stored (20261027100100_embed_replied_mail_only). The mail being drafted
for is embedded on the spot (for_message). The newest is embedded first, then older mail a batch at
a time, so the backfill never floods the API or the database.

Vectors live in public.message_embeddings, not on messages: messages is sent to open browsers by
Realtime on every change, and the vector would go with it. They are stored sealed with the user's data
key (embedding_data, see similar.py), because a vector leaks what a message means, so a user with no key
yet is not embedded. A database trigger adds a row with no vector for each incoming message, and that is
the queue worked here: a row is waiting while embedding_data is null."""

from __future__ import annotations

import time
from typing import Any

from . import log
from .fields import BODY, HTML, SUBJECT
from .gemini import Gemini, GeminiError, UsageContext
from .retry import Backoff, not_in
from .similar import SimilarIndex, open_vector, seal_vector
from .supabase import Supabase
from .text import clean
from .vault import Vault

BATCH = 48  # one embedding request (the API takes up to 100 texts) and one write for the lot
TEXT_CHARS = 2000
# Same prefix for every message: gemini-embedding-2 wants the task in the text, and similarity is symmetric.
PREFIX = "task: sentence similarity | query: "


def embed_text(subject: str | None, body_text: str | None, body_html: str | None) -> str:
    """Subject and the new writing only, without quoted history, so a reply is compared on what it says."""
    body = clean(body_text, body_html, limit=TEXT_CHARS)
    parts = [p for p in [(subject or "").strip(), body] if p]
    return PREFIX + ("\n\n".join(parts) if parts else "(no text)")


def embedding_rows(messages: list[dict[str, Any]], sealed: list[str]) -> list[dict[str, Any]]:
    """message_embeddings rows for one upsert, all with the same keys as PostgREST needs. sealed[i] is
    similar.seal_vector of messages[i]'s vector."""
    return [{"message_id": m["id"], "user_id": m["user_id"], "sent_at": m["sent_at"], "embedding_data": e} for m, e in zip(messages, sealed)]


def queue_row(row: dict[str, Any]) -> dict[str, Any]:
    """A message_embeddings queue row with its message embedded, flattened to look like a messages row."""
    return {"id": row["message_id"], "user_id": row["user_id"], "sent_at": row["sent_at"], **(row.get("messages") or {})}


class Embeddings:
    def __init__(self, db: Supabase, gemini: Gemini, model: str, vault: Vault | None = None):
        self.db = db
        self.gemini = gemini
        self.model = model
        self.vault = vault or Vault(db)  # without one, plaintext passes through
        self._backoff = Backoff()
        self.index = SimilarIndex(db, self.vault)  # the nearest-neighbour search over this user's opened vectors

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
            if self.vault.keys_for(user_id) is None:  # nothing to seal with yet: no point paying to embed
                now = time.monotonic()
                for r in batch:
                    self._backoff.failed(r["id"], now)
                continue
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

    def stored(self, user_id: str, message_id: str) -> list[float] | None:
        """The vector saved for a message, opened, or None when it has none yet or it cannot be opened."""
        keys = self.vault.keys_for(user_id)
        if keys is None:
            return None
        try:
            row = self.db.first("message_embeddings", {"select": "embedding_data", "message_id": f"eq.{message_id}", "user_id": f"eq.{user_id}", "embedding_data": "not.is.null"})
            return list(open_vector(keys, row["embedding_data"])) if row else None
        except Exception as err:
            log.warn("embedding not read", message=message_id, code=log.code_of(err))
            return None

    # Storage --------------------------------------------------------------------------------------

    def _pending(self) -> list[dict[str, Any]]:
        skip = self._backoff.waiting(time.monotonic())
        rows = self.db.select(
            "message_embeddings",
            {
                "select": "message_id,user_id,sent_at,messages(account_id,subject,body_text,body_html)",
                "embedding_data": "is.null",
                "order": "sent_at.desc",
                "limit": str(BATCH),
                **not_in(skip, "message_id"),
            },
        )
        return [queue_row(r) for r in rows]

    def _save(self, messages: list[dict[str, Any]], vectors: list[list[float]]) -> set[str]:
        """Seals the vectors with their owners' keys and saves them, all in one request. Returns the ids saved;
        a message whose owner has no key yet is not saved (a vector is never stored readable)."""
        saved: list[tuple[dict[str, Any], str]] = []
        for m, v in zip(messages, vectors):
            keys = self.vault.keys_for(m["user_id"])
            if keys is None:
                log.warn("embedding not saved, no key", user=m["user_id"])
                continue
            saved.append((m, seal_vector(keys, v)))
        if not saved:
            return set()
        try:
            self.db.upsert("message_embeddings", embedding_rows([m for m, _ in saved], [e for _, e in saved]), on_conflict="message_id")
        except Exception as err:
            log.warn("embeddings not saved", messages=len(saved), code=log.code_of(err))
            return set()
        return {m["id"] for m, _ in saved}
