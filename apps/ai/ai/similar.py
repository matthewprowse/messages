"""Finding how you answered similar emails, without the database ever holding a readable vector.

A vector says what a message means, so message_embeddings.embedding_data holds each one sealed with the
user's data key (crypto.encrypt_bytes, field EMBEDDING_DATA, base64 text). The nearest-neighbour search
therefore runs here, over the user's own vectors opened in memory: cosine similarity, which is a plain dot
product because every vector is normalised (gemini.normalise). Only the most recent MAX_VECTORS embedded
messages are searched, which is the mail drafts are written from anyway.

A user's vectors are cached for CACHE_S (45 minutes; a new embedding is added to them: add, or they are dropped: forget) so drafts read them once, and at most
MAX_USERS users are cached at a time. They are never logged or written anywhere. Once the nearest messages
are known, public.reply_pairs (a plain lookup, no vector) returns each one with the reply the user sent."""

from __future__ import annotations

import base64
import heapq
import sys
import threading
import time
from array import array
from operator import mul
from typing import Any, Sequence

from . import log
from .crypto import UserKeys, decrypt_bytes, encrypt_bytes
from .fields import EMBEDDING_DATA

# Memory: a vector is 768 float32 = about 3 KB, so the worst case is MAX_USERS x MAX_VECTORS x 3 KB =
# 32 x 2000 x 3 KB = about 192 MB. Each miss re-reads and opens up to MAX_VECTORS sealed embeddings (about 9 MB),
# which is why an entry lives long (CACHE_S) and is dropped when its user gets a new embedding (forget).
MAX_VECTORS = 2000  # the newest embedded replied-to messages searched per user
CACHE_S = 45 * 60
MAX_USERS = 32  # users whose vectors are held at once; the least recently used goes first
PAGE = 1000  # PostgREST returns at most this many rows a request
CANDIDATE_FACTOR = 4  # nearest messages looked up for replies, per reply wanted: some have none
MAX_LIMIT = 50

_BIG_ENDIAN = sys.byteorder == "big"


def pack(vector: Sequence[float]) -> bytes:
    """Little-endian float32, 4 bytes a number."""
    a = array("f", vector)
    if _BIG_ENDIAN:
        a.byteswap()
    return a.tobytes()


def unpack(data: bytes) -> array:
    a = array("f")
    a.frombytes(data)
    if _BIG_ENDIAN:
        a.byteswap()
    return a


def seal_vector(keys: UserKeys, vector: Sequence[float]) -> str:
    """The text stored in message_embeddings.embedding_data: the vector sealed, then base64."""
    return base64.b64encode(encrypt_bytes(keys, EMBEDDING_DATA, pack(vector))).decode("ascii")


def open_vector(keys: UserKeys, sealed: str) -> array:
    """The vector in embedding_data. Raises when the value was altered, moved to another field or is not sealed."""
    return unpack(decrypt_bytes(keys, EMBEDDING_DATA, base64.b64decode(sealed)))


def unit(vector: Sequence[float]) -> array:
    """A copy of vector scaled to length 1, so a dot product is the cosine. A zero vector stays zero."""
    a = array("f", vector)
    norm = sum(map(mul, a, a)) ** 0.5
    if norm > 0:
        a = array("f", (x / norm for x in a))
    return a


def dot(a: Sequence[float], b: Sequence[float]) -> float:
    return sum(map(mul, a, b))


def nearest(items: list[tuple[str, str | None, array]], query: Sequence[float], exclude_thread: str | None, count: int) -> list[tuple[str, float]]:
    """(message id, cosine similarity) of the count items closest to query, closest first, skipping the thread
    being answered. items are (message id, thread id, unit vector)."""
    q = unit(query)
    scored = ((dot(vec, q), mid) for mid, tid, vec in items if exclude_thread is None or tid != exclude_thread)
    return [(mid, score) for score, mid in heapq.nlargest(count, scored)]


class SimilarIndex:
    def __init__(self, db: Any, vault: Any, *, cache_s: float = CACHE_S, max_vectors: int = MAX_VECTORS, max_users: int = MAX_USERS):
        self.db = db
        self.vault = vault
        self.cache_s = cache_s
        self.max_vectors = max_vectors
        self.max_users = max_users
        self._lock = threading.Lock()
        self._cache: dict[str, tuple[float, list[tuple[str, str | None, array]]]] = {}  # user_id -> (valid until, items)

    def forget(self, user_id: str) -> None:
        with self._lock:
            self._cache.pop(user_id, None)

    def add(self, user_id: str, items: list[tuple[str, str | None, Sequence[float]]]) -> None:
        """Puts freshly embedded messages (id, thread id, vector) at the front of a user's cached vectors, so a new
        embedding does not throw away the whole cache and cost a full re-read and re-open. Nothing happens when the
        user is not cached: the next read loads everything anyway. A new list is stored, never the old one changed,
        because a search may be iterating it."""
        with self._lock:
            hit = self._cache.get(user_id)
            if not hit:
                return
            known = {mid for mid, _, _ in items}
            fresh = [(mid, tid, unit(vec)) for mid, tid, vec in items]
            kept = [it for it in hit[1] if it[0] not in known]
            self._cache[user_id] = (hit[0], (fresh + kept)[: self.max_vectors])

    def replies(self, user_id: str, query: Sequence[float], exclude_thread: str | None, limit: int) -> list[dict[str, Any]]:
        """The same rows public.similar_replies used to return, closest first: incoming messages from other
        conversations with the user's reply to each (a reply found by In-Reply-To, else the next one sent),
        and `similarity`. Text is still sealed as stored; the caller opens it. Empty when the user has no
        key or nothing is embedded."""
        limit = max(min(limit, MAX_LIMIT), 1)
        items = self._items(user_id)
        if not items:
            return []
        close = nearest(items, query, exclude_thread, limit * CANDIDATE_FACTOR)
        if not close:
            return []
        rows = self.db.rpc("reply_pairs", {"p_user": user_id, "p_ids": [mid for mid, _ in close]}) or []
        by_id = {r["inbound_message_id"]: r for r in rows}
        out = []
        for mid, score in close:  # closest first
            row = by_id.get(mid)
            if row:
                out.append({**row, "similarity": score})
        return out[:limit]

    def items(self, user_id: str) -> list[tuple[str, str | None, array]]:
        """A user's cached (message id, thread id, unit vector) items, loaded when not cached. Read only: do not change the list."""
        return self._items(user_id)

    def _items(self, user_id: str) -> list[tuple[str, str | None, array]]:
        now = time.monotonic()
        with self._lock:
            hit = self._cache.get(user_id)
            if hit and hit[0] > now:
                self._cache[user_id] = self._cache.pop(user_id)  # most recently used last
                return hit[1]
        items = self._load(user_id)
        with self._lock:
            self._cache.pop(user_id, None)
            self._cache[user_id] = (now + self.cache_s, items)
            while len(self._cache) > self.max_users:
                self._cache.pop(next(iter(self._cache)))
        return items

    def _load(self, user_id: str) -> list[tuple[str, str | None, array]]:
        keys = self.vault.keys_for(user_id)
        if keys is None:
            return []
        items: list[tuple[str, str | None, array]] = []
        bad = 0
        offset = 0
        while len(items) + bad < self.max_vectors:
            page = self.db.select(
                "message_embeddings",
                {
                    "select": "message_id,embedding_data,messages(thread_id)",
                    "user_id": f"eq.{user_id}",
                    "embedding_data": "not.is.null",
                    "order": "sent_at.desc,message_id",
                    "limit": str(min(PAGE, self.max_vectors - len(items) - bad)),
                    "offset": str(offset),
                },
            )
            for r in page:
                try:
                    vec = open_vector(keys, r["embedding_data"])
                except Exception:
                    bad += 1
                    continue
                items.append((r["message_id"], (r.get("messages") or {}).get("thread_id"), unit(vec)))
            if len(page) < PAGE:
                break
            offset += len(page)
        if bad:
            log.warn("embeddings could not be opened", user=user_id, count=bad)
        return items
