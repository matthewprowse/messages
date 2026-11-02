"""Same Matter: suggesting that an email thread and a chat with one person are about the same job.

Deterministic first. Two conversations are a pair when they are on different channels, share a one-to-one contact, were
last active within WINDOW_DAYS of each other, and the mean of their message vectors (the sealed embeddings similar.py holds
open in memory) points the same way: cosine at or above LINK_AT is suggested outright, between CHECK_AT and LINK_AT is
borderline. Only a borderline pair is put to the model, through `confirm`, which the caller bills under an existing feature
(learn, the one that already pays for embeddings); without it a borderline pair is dropped, so no pair costs anything by default.

Pure scoring is in `score_pair` and `find_pairs`; `suggest` reads the database and writes public.thread_links rows as
'suggested'. A pair that already has a row, whatever its status, is never written again, so a dismissal sticks."""

from __future__ import annotations

from array import array
from dataclasses import dataclass
from datetime import datetime, timezone
from itertools import combinations
from typing import Any, Callable, Sequence

from . import log
from .similar import SimilarIndex, dot, unit

WINDOW_DAYS = 14  # two conversations further apart than this (by last activity) are different matters
LINK_AT = 0.80  # cosine of the threads' mean vectors that is suggested without asking the model
CHECK_AT = 0.68  # below this nothing is suggested; from here to LINK_AT the model decides
CLOSE_DAYS = 2  # conversations this close in time need a little less similarity
CLOSE_BONUS = 0.04
MAX_THREADS = 400  # the newest conversations looked at per user: pairs grow with the square
MAX_PAIRS_ASKED = 5  # model confirmations per run for one user, so a bad day cannot run up a bill


@dataclass(frozen=True)
class MatterThread:
    """What the rules need to know about a conversation: no text."""

    id: str
    channel: str
    contact: str | None  # the other person of a one-to-one conversation; None for a group
    last_at: datetime
    vector: array | None  # unit mean of its message vectors


@dataclass(frozen=True)
class Pair:
    a: str
    b: str
    contact: str
    score: float
    borderline: bool  # the rules were not sure: ask the model before suggesting


def mean_vector(vectors: Sequence[Sequence[float]]) -> array | None:
    """The unit vector in the middle of these (themselves unit) vectors; None for none, or when they cancel out."""
    if not vectors:
        return None
    total = array("f", [0.0]) * len(vectors[0])
    for v in vectors:
        for i, x in enumerate(v):
            total[i] += x
    out = unit(total)
    return out if any(out) else None


def score_pair(x: MatterThread, y: MatterThread) -> Pair | None:
    """The pair when the rules would suggest it (or are unsure), else None. Order of x and y does not matter."""
    if x.channel == y.channel or not x.contact or x.contact != y.contact or x.vector is None or y.vector is None:
        return None
    if len(x.vector) != len(y.vector):
        return None
    gap_days = abs((x.last_at - y.last_at).total_seconds()) / 86_400
    if gap_days > WINDOW_DAYS:
        return None
    bonus = CLOSE_BONUS if gap_days <= CLOSE_DAYS else 0.0
    score = dot(x.vector, y.vector)
    if score + bonus < CHECK_AT:
        return None
    a, b = sorted((x.id, y.id))
    return Pair(a, b, x.contact, round(score, 4), borderline=score + bonus < LINK_AT)


def find_pairs(threads: Sequence[MatterThread]) -> list[Pair]:
    """Every pair the rules suggest or doubt, most similar first."""
    out = [p for x, y in combinations(threads, 2) if (p := score_pair(x, y))]
    return sorted(out, key=lambda p: -p.score)


def _parse(iso: str | None) -> datetime | None:
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")) if iso else None
    except ValueError:
        return None


def build_threads(rows: list[dict[str, Any]], participants: dict[str, list[str]], by_thread: dict[str, list[Sequence[float]]]) -> list[MatterThread]:
    """MatterThreads from thread rows (id, channel, is_group, last_message_at), their contact ids and their vectors."""
    out = []
    for r in rows:
        at = _parse(r.get("last_message_at"))
        if at is None:
            continue
        who = participants.get(r["id"], [])
        contact = who[0] if not r.get("is_group") and len(who) == 1 else None
        out.append(MatterThread(r["id"], r["channel"], contact, at if at.tzinfo else at.replace(tzinfo=timezone.utc), mean_vector(by_thread.get(r["id"], []))))
    return out


def suggest(db: Any, index: SimilarIndex, user_id: str, confirm: Callable[[Pair], bool] | None = None, *, max_asked: int = MAX_PAIRS_ASKED) -> int:
    """Writes 'suggested' thread_links rows for a user's likely same-matter pairs and returns how many. `confirm` answers a
    borderline pair (True keeps it, recorded with source 'ai'); left out, borderline pairs are skipped."""
    rows = db.select(
        "threads",
        {"select": "id,channel,is_group,last_message_at", "user_id": f"eq.{user_id}", "status": "neq.trash", "last_message_at": "not.is.null", "order": "last_message_at.desc", "limit": str(MAX_THREADS)},
    )
    if len(rows) < 2:
        return 0
    ids = [r["id"] for r in rows]
    parts: dict[str, list[str]] = {}
    for p in db.select("thread_participants", {"select": "thread_id,contact_id", "user_id": f"eq.{user_id}", "thread_id": f"in.({','.join(ids)})"}):
        parts.setdefault(p["thread_id"], []).append(p["contact_id"])
    vectors: dict[str, list[Sequence[float]]] = {}
    for _mid, tid, vec in index.items(user_id):
        if tid in parts:
            vectors.setdefault(tid, []).append(vec)
    pairs = find_pairs(build_threads(rows, parts, vectors))
    if not pairs:
        return 0
    known = {
        (r["thread_a"], r["thread_b"])
        for r in db.select("thread_links", {"select": "thread_a,thread_b", "user_id": f"eq.{user_id}", "thread_a": f"in.({','.join(ids)})"})
    }
    fresh = []
    asked = 0
    for p in pairs:
        if (p.a, p.b) in known:
            continue
        source = "similarity"
        if p.borderline:
            if confirm is None or asked >= max_asked:
                continue
            asked += 1
            if not confirm(p):
                continue
            source = "ai"
        fresh.append({"user_id": user_id, "thread_a": p.a, "thread_b": p.b, "contact_id": p.contact, "status": "suggested", "score": p.score, "source": source})
    # insert_new, not an upsert: a pair decided meanwhile (a dismissal) must never be overwritten.
    written = sum(len(db.insert_new("thread_links", row, "user_id,thread_a,thread_b")) for row in fresh)
    if written:
        log.info("same matter suggested", user=user_id, count=written, asked=asked)
    return written
