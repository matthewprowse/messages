"""Drafts in your voice. The app adds a pending row to drafts; this fills in the body.

Your voice comes in layers: what you said about yourself and style rules learned from your sent mail,
edits and choices (everyone); a note on how you write to this person and who they are (per person);
and the conversation itself. Voice examples are how you answered the emails most like this one
(found by embedding, public.similar_replies), then your own sent mail to this person and anyone.
The reads before the model call run at once, so a draft waits about three round trips instead of nine.

The prompt puts what is the same for all your drafts first (who you are, your rules, saved examples,
recent sent mail), then this person, then the conversation, and the tone, the decision picked with
guided drafting's choices and the instruction last. Gemini
bills a repeated start of a request at a tenth of the price, so asking again with another tone costs
little more than the new lines.

Up to MAX_RUNNING drafts are written at once, one at a time per conversation and oldest first, so the
newest request is the one left as the live draft. The table is checked every POLL_IDLE_S, and every
POLL_ACTIVE_S for a while after a draft was asked for, when another (a different tone) is likely."""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from . import log
from .embed import Embeddings, vector_literal
from .fields import BODY, DRAFT, HTML, INSTRUCTION, SUBJECT
from .gemini import Gemini, GeminiError, UsageContext
from .retry import not_in
from .supabase import Supabase, in_list
from .text import clean
from .vault import Vault

SIMILAR_LIMIT = 3
MIN_SIMILARITY = 0.7  # cosine similarity below this is not "an email like this one"
SIMILAR_IN_CHARS = 250
SIMILAR_OUT_CHARS = 500
VOICE_CHARS = 600
MAX_VOICE = 6  # similar replies and voice examples together, unless this person's own emails add more
RECENT_VOICE = 3  # recent sent emails in the part of the prompt that is the same for every draft
TO_THEM_VOICE = 3
MAX_ATTEMPTS = 3  # unexpected errors on one draft before it is failed instead of retried forever
STALE_AFTER = timedelta(minutes=10)  # a draft still pending this long is failed, so the app never spins forever
SWEEP_EVERY_S = 30  # how often drafts pending too long are looked for
MAX_RUNNING = 4
POLL_IDLE_S = 1.5
POLL_ACTIVE_S = 0.5
ACTIVE_FOR_S = 120

SCHEMA = {
    "type": "object",
    "properties": {"body": {"type": "string", "description": "The reply text only, ready to send."}},
    "required": ["body"],
}

SYSTEM = """You write email replies for one person, in their own voice, as if they wrote it themselves.

- Write only the reply body: no subject line, no quoted text, no notes to them, no placeholders like [Name].
- Match how they actually write: their greetings, sign-offs, length, punctuation and level of formality, taken from their examples and rules. When their examples sign off with a name, do the same.
- Their examples, past emails and similar replies show how they write, never who this reply is to or what it is about. Never take a name, fact or detail from them. Greet the person by name only when "Replying to" gives one; otherwise greet without a name.
- Answer what the other person asked. Do not invent facts, dates, prices or commitments they have not made. When something needs a decision only they can make, write the reply so it leaves that open or asks one short question.
- When you are told what they decided, the reply says exactly that, in their voice, and nothing that contradicts or goes beyond it.
- Plain text. No markdown, no emojis unless their own examples use them.
- Never use em dashes."""

TONES = {
    "default": "Their usual voice for this person.",
    "shorter": "Shorter than they would usually write: just what is needed.",
    "formal": "More formal than usual, still clearly them.",
    "casual": "More casual and relaxed than usual, still clearly them.",
}


def build_prompt(
    *,
    me: str,
    about: str,
    rules: list[str],
    examples: list[tuple[str, str]],
    recent: list[str],
    them: str,
    relationship: str,
    style_note: str,
    who_they_are: str = "",
    person_rules: list[str] | None = None,
    more_voice: list[str] | None = None,
    similar: list[tuple[str, str]] | None = None,
    conversation: list[tuple[str, str]],
    tone: str,
    instruction: str | None,
    decision: str | None = None,
) -> str:
    """You first (the same for every draft, so Gemini can bill it at the cached rate), then this person,
    then the conversation, and what you asked for last."""
    lines = [f"You are writing as: {me or 'the user'}", f"About them: {about or 'not given'}"]
    if rules:
        lines += ["", "Rules learned from their sent mail and how they edit drafts:"] + [f"- {r}" for r in rules]
    if examples:
        lines += ["", "Examples they saved:"] + [f"[{situation}]\n{body}\n" for situation, body in examples]
    if recent:
        lines += ["", "Their own recent sent emails (for voice, not content):"] + [f"---\n{v}" for v in recent]
    # With no name, the model would fill a "Hi [Name]" rule with a name from the examples, so it is told.
    replying = them or "someone whose name is not known. Greet them without a name, for example 'Hi,'"
    lines += ["", f"Replying to: {replying}", f"Relationship: {relationship or 'unknown'}"]
    if who_they_are:
        lines.append(f"Who this person is: {who_they_are}")
    if style_note:
        lines.append(f"How they write to this person: {style_note}")
    if person_rules:
        lines += ["", "Rules for writing to this person:"] + [f"- {r}" for r in person_rules]
    if more_voice:
        lines += ["", "More of their own sent emails, to this person first (for voice, not content):"] + [f"---\n{v}" for v in more_voice]
    if similar:
        lines += ["", "How they answered similar emails before (for voice and approach, not facts):"]
        lines += [f"--- They received:\n{inbound}\n--- They replied:\n{reply}" for inbound, reply in similar]
    lines += ["", "The conversation, oldest first:"] + [f"--- {who}:\n{text}" for who, text in conversation]
    lines += ["", f"Tone: {TONES.get(tone, TONES['default'])}"]
    if decision:
        lines.append(f"What they decided to say: {decision}")
    if instruction:
        lines.append(f"Their instruction for this reply: {instruction}")
    lines.append("\nWrite their reply to the last message.")
    return "\n".join(lines)


def pick_drafts(pending: list[dict[str, Any]], running: dict[str, str], room: int) -> list[dict[str, Any]]:
    """Pending drafts (oldest first) to start now: at most room, none for a conversation that already
    has one being written, and only the oldest per conversation, so the newest ends up the live draft."""
    busy = set(running.values())
    picked = []
    for d in pending:
        if len(picked) >= room:
            break
        if d["id"] in running or d["thread_id"] in busy:
            continue
        busy.add(d["thread_id"])
        picked.append(d)
    return picked


class Drafts:
    def __init__(self, db: Supabase, gemini: Gemini, model: str, embeddings: Embeddings | None = None, vault: Vault | None = None):
        self.db = db
        self.gemini = gemini
        self.model = model
        self.embeddings = embeddings
        self.vault = vault or Vault(db)  # without one, plaintext passes through and nothing is encrypted
        self._pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="draft-read")
        self._runner = ThreadPoolExecutor(max_workers=MAX_RUNNING, thread_name_prefix="draft")
        self._lock = threading.Lock()
        self._running: dict[str, str] = {}  # draft id -> thread id, while it is being written
        self._attempts: dict[str, int] = {}
        self._swept = 0.0
        self._active_until = 0.0

    def poll_wait(self) -> float:
        """Seconds until the next check: sooner while drafts are being asked for."""
        busy = self._running or time.monotonic() < self._active_until
        return POLL_ACTIVE_S if busy else POLL_IDLE_S

    def run_once(self) -> int:
        """Starts pending drafts in the background. Returns how many were started."""
        if time.monotonic() - self._swept >= SWEEP_EVERY_S:
            self._swept = time.monotonic()
            cutoff = (datetime.now(timezone.utc) - STALE_AFTER).isoformat()
            self.db.update(
                "drafts",
                {"status": "eq.pending", "created_at": f"lt.{cutoff}"},
                {"status": "failed", "error": "The draft took too long. Try again.", "updated_at": _now()},
                minimal=True,
            )
        with self._lock:
            running = dict(self._running)
        if len(running) >= MAX_RUNNING:
            return 0
        pending = self.db.select(
            "drafts",
            {
                "select": "id,user_id,thread_id,tone,instruction,decision",
                "status": "eq.pending",
                "order": "created_at",
                "limit": str(MAX_RUNNING * 2),
                **not_in(list(running)),
            },
        )
        if pending:
            self._active_until = time.monotonic() + ACTIVE_FOR_S
        for d in pending:
            self.vault.open_row(d["user_id"], d, [("instruction", INSTRUCTION), ("decision", INSTRUCTION)])
        started = pick_drafts(pending, running, MAX_RUNNING - len(running))
        for d in started:
            with self._lock:
                self._running[d["id"]] = d["thread_id"]
            self._runner.submit(self._run, d)
        return len(started)

    def _run(self, d: dict[str, Any]) -> None:
        try:
            self._draft(d)
            self._attempts.pop(d["id"], None)
        except Exception as err:
            # A database or network error mid-draft: the next check tries again, a couple of times, then stops.
            attempts = self._attempts.get(d["id"], 0) + 1
            self._attempts[d["id"]] = attempts
            log.warn("draft error", draft=d["id"], attempts=attempts, code=getattr(err, "code", None) or type(err).__name__)
            if attempts >= MAX_ATTEMPTS:
                self._attempts.pop(d["id"], None)
                try:
                    self._fail(d, "The draft could not be written. Try again.")
                except Exception:
                    pass
        finally:
            with self._lock:
                self._running.pop(d["id"], None)
            self._active_until = time.monotonic() + ACTIVE_FOR_S

    def _fail(self, d: dict[str, Any], reason: str) -> None:
        self.db.update("drafts", {"id": f"eq.{d['id']}"}, {"status": "failed", "error": reason, "updated_at": _now()}, minimal=True)

    def _all(self, calls: dict[str, Callable[[], Any]]) -> dict[str, Any]:
        """Runs independent reads at once: each is a Supabase round trip of about a quarter second."""
        futures = {name: self._pool.submit(fn) for name, fn in calls.items()}
        return {name: f.result() for name, f in futures.items()}

    def _gather(self, d: dict[str, Any]) -> dict[str, Any] | str:
        """Everything the prompt needs, or the reason the draft cannot be written. Reads only."""
        user = d["user_id"]
        first = self._all(
            {
                "thread": lambda: self.db.first("threads", {"select": "id,user_id,account_id,subject", "id": f"eq.{d['thread_id']}"}),
                # Scoped by user as well, so nothing from someone else's thread is ever fetched.
                "messages": lambda: self.db.select(
                    "messages",
                    {
                        "select": "id,direction,sender_contact_id,body_text,body_html,subject,sent_at",
                        "thread_id": f"eq.{d['thread_id']}",
                        "user_id": f"eq.{user}",
                        "order": "sent_at.desc",
                        "limit": "12",
                    },
                ),
                "profile": lambda: self.db.first("profiles", {"select": "display_name,about", "user_id": f"eq.{user}"}),
                "rules": lambda: self.db.select(
                    "style_rules",
                    {
                        "select": "rule,scope,contact_id",
                        "user_id": f"eq.{user}",
                        "enabled": "eq.true",
                        "order": "support_count.desc,id",  # a stable order keeps the start of the prompt the same
                        "limit": "40",
                    },
                ),
                "examples": lambda: self.db.select(
                    "writing_examples", {"select": "situation,body", "user_id": f"eq.{user}", "order": "created_at,id", "limit": "5"}
                ),
                "recent": lambda: self.db.select(
                    "messages",
                    {"select": "body_text,body_html", "user_id": f"eq.{user}", "direction": "eq.outbound", "order": "sent_at.desc,id", "limit": "8"},
                ),
            }
        )
        thread = first["thread"]
        # The draft row is the user's; the thread must be theirs too, or nothing read is used.
        if not thread or thread["user_id"] != user:
            return "This conversation could not be found."
        # Opened before anything reads them, the embedding of latest_in for similar replies included.
        self.vault.open_row(user, thread, [("subject", SUBJECT)])
        for m in first["messages"]:
            self.vault.open_row(user, m, [("subject", SUBJECT), ("body_text", BODY), ("body_html", HTML)])
        for m in first["recent"]:
            self.vault.open_row(user, m, [("body_text", BODY), ("body_html", HTML)])
        messages = first["messages"][::-1]
        if not messages:
            return "There is nothing to reply to yet."

        profile = first["profile"] or {}
        contact_id = next((m["sender_contact_id"] for m in reversed(messages) if m["direction"] == "inbound" and m["sender_contact_id"]), None)
        latest_in = next((m for m in reversed(messages) if m["direction"] == "inbound"), None)
        calls: dict[str, Callable[[], Any]] = {"similar": lambda: self._similar(user, thread, latest_in)}
        if contact_id:
            calls["contact"] = lambda: self.db.first(
                "contacts",
                {
                    "select": "id,display_name,relationship,style_note,ai_summary,organizations(name,summary)",
                    "id": f"eq.{contact_id}",
                    "user_id": f"eq.{user}",
                },
            )
            calls["to_them"] = lambda: self._sent_to(user, contact_id, thread["id"])
        second = {"contact": None, "to_them": [], **self._all(calls)}
        contact = second["contact"] or {}
        org = contact.get("organizations") or {}
        similar = second["similar"]
        names = {contact.get("id"): contact.get("display_name")} if contact else {}

        global_rules = [r["rule"] for r in first["rules"] if r["scope"] == "global"][:20]
        person_rules = [r["rule"] for r in first["rules"] if contact_id and r["scope"] == "contact" and r.get("contact_id") == contact_id][:10]
        examples = [(e["situation"], e["body"]) for e in first["examples"]]
        recent = pick_voice([], first["recent"], limit=RECENT_VOICE)
        more = pick_more_voice(second["to_them"], first["recent"], shown=recent, similar=similar)

        conversation = []
        for m in messages:
            who = "Them" if m["direction"] == "inbound" else "Me"
            if m["direction"] == "inbound" and m.get("sender_contact_id") in names:
                who = names[m["sender_contact_id"]] or "Them"
            conversation.append((who, clean(m.get("body_text"), m.get("body_html"), limit=1500)))

        return {
            "thread": thread,
            "prompt": build_prompt(
                me=profile.get("display_name") or "",
                about=profile.get("about") or "",
                rules=global_rules,
                examples=examples,
                recent=recent,
                them=contact.get("display_name") or "",
                relationship=contact.get("relationship") or "",
                style_note=contact.get("style_note") or "",
                who_they_are=contact.get("ai_summary") or (f"{org['name']}: {org['summary']}" if org.get("summary") else ""),
                person_rules=person_rules,
                more_voice=more,
                similar=similar,
                conversation=conversation,
                tone=d.get("tone") or "default",
                instruction=d.get("instruction"),
                decision=d.get("decision"),
            ),
        }

    def _draft(self, d: dict[str, Any]) -> None:
        gathered = self._gather(d)
        if isinstance(gathered, str):
            self._fail(d, gathered)
            return
        thread, prompt = gathered["thread"], gathered["prompt"]
        try:
            result = self.gemini.json(
                self.model,
                SYSTEM,
                prompt,
                SCHEMA,
                UsageContext(d["user_id"], "draft", thread["account_id"], thread["id"]),
                temperature=0.6,
                thinking="low",
                attempts=3,  # someone is waiting: fail and let them try again rather than wait minutes
                timeout=60,
            )
        except GeminiError as err:
            log.warn("draft failed", draft=d["id"], status=err.status)
            self._fail(d, "The draft could not be written. Try again.")
            return

        body = (result.get("body") or "").replace("—", ", ").replace("–", "-").strip()
        if not body:
            self._fail(d, "The draft came back empty. Try again.")
            return
        written = self.db.update(
            "drafts",
            {"id": f"eq.{d['id']}", "status": "eq.pending"},
            {"body": self.vault.seal(d["user_id"], DRAFT, body), "status": "active", "model": self.model, "error": None, "updated_at": _now()},
        )
        if not written:
            # The app gave up waiting and withdrew it, so the draft it already shows (if any) stays.
            log.info("draft withdrawn", draft=d["id"])
            return
        # One live draft per conversation: older ones are replaced.
        self.db.update(
            "drafts",
            {"thread_id": f"eq.{thread['id']}", "status": "eq.active", "id": f"neq.{d['id']}"},
            {"status": "discarded", "updated_at": _now()},
            minimal=True,
        )
        log.info("draft written", draft=d["id"])

    def _similar(self, user: str, thread: dict[str, Any], latest_in: dict[str, Any] | None) -> list[tuple[str, str]]:
        """How you answered the emails most like the one being answered, from other conversations.
        Never fails the draft: without embeddings it returns nothing and the recent mail is used."""
        if not latest_in or not latest_in.get("id") or self.embeddings is None:
            return []
        try:
            vector = self.embeddings.stored(latest_in["id"], user)
            if not vector:
                values = self.embeddings.for_message(latest_in, user, thread.get("account_id"), thread["id"])
                if values is None:
                    return []
                vector = vector_literal(values)
            rows = self.db.rpc("similar_replies", {"p_user": user, "p_embedding": vector, "p_limit": SIMILAR_LIMIT * 2, "p_exclude_thread": thread["id"]}) or []
        except Exception as err:
            log.warn("similar replies unavailable", thread=thread["id"], code=getattr(err, "code", None) or type(err).__name__)
            return []
        for r in rows:  # both texts are messages.body_text, so both open as BODY
            self.vault.open_row(user, r, [("inbound_subject", SUBJECT), ("inbound_text", BODY), ("reply_text", BODY)])
        return pick_similar(rows, thread["id"])

    def _sent_to(self, user: str, contact_id: str, skip_thread: str) -> list[dict[str, Any]]:
        """Their latest sent emails in other conversations with this person."""
        threads = self.db.select("thread_participants", {"select": "thread_id", "contact_id": f"eq.{contact_id}", "limit": "30"})
        ids = [t["thread_id"] for t in threads if t["thread_id"] != skip_thread]
        if not ids:
            return []
        rows = self.db.select(
            "messages",
            {"select": "body_text,body_html", "thread_id": in_list(ids), "direction": "eq.outbound", "order": "sent_at.desc", "limit": "3"},
        )
        return [self.vault.open_row(user, m, [("body_text", BODY), ("body_html", HTML)]) for m in rows]


def pick_voice(to_them: list[dict[str, Any]], recent: list[dict[str, Any]], *, limit: int = MAX_VOICE, skip: list[str] | None = None) -> list[str]:
    """A few of their own sent emails, to this person first, then anyone, at most `limit`. Emails
    already shown as similar replies (`skip`) are not repeated."""
    picked: list[str] = []
    for m in to_them + recent:
        text = clean(m.get("body_text"), m.get("body_html"), limit=VOICE_CHARS)
        if text and text not in picked and text[:200] not in [s[:200] for s in skip or []] and len(picked) < max(limit, 0):
            picked.append(text)
    return picked


def pick_more_voice(to_them: list[dict[str, Any]], recent: list[dict[str, Any]], *, shown: list[str], similar: list[tuple[str, str]]) -> list[str]:
    """Voice examples for this person, after the RECENT_VOICE shown for everyone: up to TO_THEM_VOICE
    of their emails to this person, then more recent mail while the prompt holds fewer than MAX_VOICE
    examples in all. Nothing already shown (recent or a similar reply) is repeated."""
    skip = shown + [reply for _, reply in similar]
    theirs = pick_voice(to_them, [], limit=TO_THEM_VOICE, skip=skip)
    room = MAX_VOICE - len(similar) - len(shown) - len(theirs)
    return theirs + pick_voice([], recent, limit=room, skip=skip + theirs)


def pick_similar(rows: list[dict[str, Any]], current_thread: str) -> list[tuple[str, str]]:
    """(what they received, how they replied) from similar_replies, closest first: other conversations
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
