"""Drafting's limits and pure helpers: the size caps for what goes in a prompt, which pending drafts to start,
which notes, voice examples and similar replies to show, and small checks. No network, no database. Split out of
drafts.py, which re-exports every name here."""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from .text import clean

SIMILAR_LIMIT = 3
MIN_SIMILARITY = 0.7  # cosine similarity below this is not "an email like this one"
# Similar replies and the extra voice examples come from other conversations: they are there for how the person writes,
# so they are kept short enough to show a voice and too short to carry another client's details into this reply.
SIMILAR_IN_CHARS = 160
SIMILAR_OUT_CHARS = 300
VOICE_CHARS = 400
MORE_VOICE_CHARS = 250  # of each extra voice example (pick_more_voice), after the RECENT_VOICE at VOICE_CHARS
OLDER_CHARS = 600  # of a message older than the last two in the conversation; the last two get 1500
MAX_VOICE = 6  # similar replies and voice examples together, unless this person's own emails add more
RECENT_VOICE = 2  # recent sent emails in the part of the prompt that is the same for every draft
TO_THEM_VOICE = 3
FACT_CHARS = 1500  # of one note marked Use in Drafts
FACTS_CHARS = 6000  # of them all, so a few long notes cannot crowd out the conversation
MAX_ATTEMPTS = 3  # unexpected errors on one draft before it is failed instead of retried forever
STALE_AFTER = timedelta(minutes=10)  # a draft still pending this long is failed, so the app never spins forever
SWEEP_EVERY_S = 60  # how often drafts pending too long are looked for (STALE_AFTER is 10 minutes, so a minute late is nothing)
AUDIO_SWEEP_EVERY_S = 300  # leftover recordings: the query (status<>pending and audio_path not null) has no index, so it runs rarely
BILLING_HOLD_S = 30  # after billing_paused, pending drafts are left alone this long instead of asked about every half second
DRAFT_MAX_OUTPUT = 4096  # tokens, thinking included: a reply is a few hundred; this only stops a runaway
COMPOSE_PER_HOUR = 10  # new-message drafts a person can ask for in an hour, as threaded ones are limited per conversation


def own_audio_path(user_id: Any, path: Any) -> bool:
    """True only for "<user id>/drafts/<name>" (more folders allowed) made of plain name characters. The row's
    audio_path is written by the app under row-level security that only checks the start of it, and this worker
    reads and deletes with the service role, so "<uid>/drafts/../../<other user>/x" must never get through."""
    if not user_id or not isinstance(path, str):
        return False
    return re.fullmatch(re.escape(str(user_id)) + r"/drafts/[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*", path) is not None and not {"..", "."} & set(path.split("/"))



def pick_drafts(pending: list[dict[str, Any]], running: dict[str, str], room: int) -> list[dict[str, Any]]:
    """Pending drafts (oldest first) to start now: at most room, none for a conversation that already
    has one being written, and only the oldest per conversation, so the newest ends up the live draft."""
    busy = set(running.values())
    picked = []
    for d in pending:
        if len(picked) >= room:
            break
        if d["id"] in running or (d["thread_id"] or d["id"]) in busy:
            continue
        busy.add(d["thread_id"] or d["id"])  # a new message has no conversation: it is its own
        picked.append(d)
    return picked



def pick_facts(notes: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Notes marked Use in Drafts as (title, text), in the order given, each cut to FACT_CHARS and all to
    FACTS_CHARS. Empty notes are left out."""
    out: list[tuple[str, str]] = []
    room = FACTS_CHARS
    for title, body in notes:
        body = body.strip()[:FACT_CHARS]
        if not body or room <= 0:
            continue
        body = body[:room]
        room -= len(body)
        out.append((title.strip(), body))
    return out


MEDIA = {"imageMessage": "photo", "videoMessage": "video", "stickerMessage": "sticker", "audioMessage": "voice note", "documentMessage": "document"}


def describe(m: dict[str, Any], limit: int = 1500) -> str:
    """A message as the prompt shows it: what it carries (attachments, media) and what it quotes, then its
    text. Without these a draft answered "here's the file" as if nothing was attached."""
    text = clean(m.get("body_text"), m.get("body_html"), limit=limit)
    extra = []
    files = [f for f in m.get("files") or [] if f]
    if files:
        extra.append("attached: " + ", ".join(files[:5]))
    elif m.get("media") and not m.get("transcript"):
        extra.append(MEDIA.get(m["media"], "file"))
    quoted = m.get("quoted") if isinstance(m.get("quoted"), dict) else {}
    if (quoted.get("text") or "").strip():
        whose = "their own" if quoted.get("from_me") else "the"
        extra.append(f"replying to {whose} message: " + quoted["text"].strip().replace("\n", " ")[:140])
    head = f"({'; '.join(extra)})" if extra else ""
    return (head + ("\n" if head and text else "") + text) or "(no text)"


def keep_quotes(source: str, edited: str) -> str:
    """The edit with straight quotes and apostrophes when you typed straight ones: the model tends to
    make them curly, which is a change you did not ask for."""
    if any(c in source for c in "‘’“”"):
        return edited
    return edited.replace("‘", "'").replace("’", "'").replace("“", '"').replace("”", '"')


def stale(d: dict[str, Any], newest_first: list[dict[str, Any]], choices: str | None) -> bool:
    """True when a pre-draft is no longer wanted: its message is not the conversation's latest any more,
    or it has guided drafting choices (opened JSON), which need the user's decision before a draft."""
    if not newest_first or newest_first[0].get("id") != d.get("for_message_id"):
        return True
    try:
        return bool((json.loads(choices) if choices else {}).get("options"))
    except (ValueError, AttributeError):
        return False


def others_voice_ok(newest_first: list[dict[str, Any]], to_them: list[dict[str, Any]], suspicious: bool) -> bool:
    """Whether a reply may be shown other conversations (similar replies, more sent mail) for its voice. Not when the
    latest message is flagged suspicious, nor for a sender they have never written to (nothing outbound in this
    conversation and no sent mail to them): a stranger's email is the one that would ask for another client's details."""
    if suspicious:
        return False
    return any(m.get("direction") == "outbound" for m in newest_first) or bool(to_them)


def pick_voice(to_them: list[dict[str, Any]], recent: list[dict[str, Any]], *, limit: int = MAX_VOICE, skip: list[str] | None = None, chars: int = VOICE_CHARS) -> list[str]:
    """A few of their own sent emails, to this person first, then anyone, at most `limit`, each cut to chars. Emails
    already shown as similar replies (`skip`) are not repeated."""
    picked: list[str] = []
    for m in to_them + recent:
        text = clean(m.get("body_text"), m.get("body_html"), limit=chars)
        if text and text not in picked and text[:200] not in [s[:200] for s in skip or []] and len(picked) < max(limit, 0):
            picked.append(text)
    return picked


def pick_more_voice(to_them: list[dict[str, Any]], recent: list[dict[str, Any]], *, shown: list[str], similar: list[tuple[str, str]]) -> list[str]:
    """Voice examples for this person, after the RECENT_VOICE shown for everyone: up to TO_THEM_VOICE
    of their emails to this person, then more recent mail while the prompt holds fewer than MAX_VOICE
    examples in all. Nothing already shown (recent or a similar reply) is repeated."""
    skip = shown + [reply for _, reply in similar]
    theirs = pick_voice(to_them, [], limit=TO_THEM_VOICE, skip=skip, chars=MORE_VOICE_CHARS)
    room = MAX_VOICE - len(similar) - len(shown) - len(theirs)
    return theirs + pick_voice([], recent, limit=room, skip=skip + theirs, chars=MORE_VOICE_CHARS)


def pick_similar(rows: list[dict[str, Any]], current_thread: str) -> list[tuple[str, str]]:
    """(what they received, how they replied) from the similar-reply search, closest first: other conversations
    only, close enough to count, with a reply that says something, one per conversation."""
    out: list[tuple[str, str]] = []
    threads: set[str] = set()
    for r in rows:
        if r.get("thread_id") == current_thread or r.get("thread_id") in threads or float(r.get("similarity") or 0) < MIN_SIMILARITY:
            continue
        reply = clean(r.get("reply_text"), limit=SIMILAR_OUT_CHARS)
        inbound = clean(r.get("inbound_text"), limit=SIMILAR_IN_CHARS) or (r.get("inbound_subject") or "")
        if not reply or not inbound:
            continue
        threads.add(r["thread_id"])
        out.append((inbound, reply))
        if len(out) == SIMILAR_LIMIT:
            break
    return out


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
