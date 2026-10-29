"""Drafts in your voice. The app adds a pending row to drafts; this fills in the body.

Your voice comes in layers: what you said about yourself and style rules learned from your sent mail,
edits and choices (everyone); a note on how you write to this person and who they are (per person);
and the conversation itself. Voice examples are how you answered the emails most like this one
(found by embedding, similar.py), then your own sent mail to this person and anyone.
Everything before the model call is read in one call to public.draft_context, one round trip.

The prompt puts what is the same for all your drafts first (who you are, your rules, saved examples,
recent sent mail), then this person, then the conversation, and the tone, the decision picked with
guided drafting's choices and the instruction last. Gemini
bills a repeated start of a request at a tenth of the price, but only past about 1,024 tokens. The shared
start (voice examples cut to VOICE_CHARS, RECENT_VOICE of them, older messages to OLDER_CHARS) is kept short
on purpose, as every input token is paid for; the prompt was about 1,100 tokens in October 2026 and is
smaller now, so little is cached. The order is kept for when prompts grow. Tones are cheap another way: they adjust the text on the fast model.

Up to MAX_RUNNING drafts are written at once, one at a time per conversation and oldest first, so the
newest request is the one left as the live draft. The table is checked every POLL_IDLE_S, and every
POLL_ACTIVE_S for a while after a draft was asked for, when another (a different tone) is likely.

A pre-draft (drafts.auto, asked for by the app with public.request_auto_draft while it is open) is
written after the drafts people asked for, and dropped as 'expired' without asking the model when its
message (for_message_id) is no longer the latest or has guided drafting choices: those need your
decision first. A pre-draft that is replaced is expired, not discarded, so learning never reads a
draft you did not see as one you threw away.

A draft with tone 'edit' carries text you wrote yourself (drafts.source). It is not rewritten: the same
prompt, ending with your text instead, asks for the fewest changes that fix it (EDIT_SYSTEM). Shorter,
More Formal and More Casual with source are an adjustment of the text in your reply box (ADJUST_SYSTEM),
so your own changes and every fact in it are kept. Both are revisions: they run on the fast model, and
the draft they replace is 'revised', which learning does not read as a draft you threw away.

A draft with audio_path was asked for by voice: the app sealed a recording of what you want the reply to
say. It is heard in the same model call that writes the draft, what you said is kept as the draft's
instruction (so another try or an adjustment works from text), and the recording is deleted.

A draft with no thread_id is a new message, from New Email or New WhatsApp: account_id is the account it
goes out from, contact_id who it is to when they are a contact. Its context comes from
public.compose_context (you, your rules, facts and voice, and this person) and an email one gets a
subject too.

A new draft in a work chat (or a shared inbox chat) of a team also carries the team's company voice
(company_voice.py): read with public.company_voice_for_draft, which returns nothing for a personal chat, so
a personal chat's prompt is exactly what it was. Your own style wins on wording and the company's rules and
facts win on content. Edits, adjustments and new messages do not use it."""

from __future__ import annotations

import json
import os
import re
import threading
import time
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from datetime import datetime, timedelta, timezone
from typing import Any

from . import log
from .company_voice import COMPANY_SYSTEM, company_lines, pick_company
from .embed import Embeddings
from .poll import Backoff
from .fields import CONTACT_RELATIONSHIP, CONTACT_STYLE_NOTE, CONTACT_SUMMARY, STYLE_RULE, WRITING_BODY, WRITING_SITUATION, BODY, CHOICES, DRAFT, HTML, INSTRUCTION, NAME, NOTE, NOTE_TITLE, QUOTE, SUBJECT, TRANSCRIPT, VOICE_INSTRUCTION
from .config import edit_thinking, draft_thinking
from .gemini import DEFAULT_LIMITS, Gemini, GeminiError, UsageContext
from .retry import billing_paused, not_in
from .supabase import Supabase, in_list
from .text import UNTRUSTED, clean, fenced, new_fence
from .vault import Vault

SIMILAR_LIMIT = 3
MIN_SIMILARITY = 0.7  # cosine similarity below this is not "an email like this one"
SIMILAR_IN_CHARS = 250
SIMILAR_OUT_CHARS = 500
VOICE_CHARS = 400
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
MAX_RUNNING = 4
HEDGE_AFTER_S = 4.5  # past the model's p90 (about 3.3s on a draft): a second request is sent and the first answer used
DRAFT_MAX_OUTPUT = 4096  # tokens, thinking included: a reply is a few hundred; this only stops a runaway
COMPOSE_PER_HOUR = 10  # new-message drafts a person can ask for in an hour, as threaded ones are limited per conversation


def hedge_on() -> bool:
    """The hedged second request is off unless DRAFT_HEDGE is "true": about one draft in ten was billed twice for it."""
    return os.environ.get("DRAFT_HEDGE", "").strip().lower() == "true"
POLL_IDLE_S = 1.5
# A quiet worker looks every 1.5s, 2.25s, ... up to this. Nothing wakes the loop early, so a draft asked for after
# a quiet spell waits up to this long: 10s, not 15s, keeps that worst case tolerable (about 6 looks a minute idle,
# down from 12), and the 0.5s active cadence returns the moment a pending draft is found.
POLL_IDLE_MAX_S = 10.0
POLL_ACTIVE_S = 0.5
ACTIVE_FOR_S = 120

SCHEMA = {
    "type": "object",
    "properties": {"body": {"type": "string", "description": "The reply text only, ready to send."}},
    "required": ["body"],
}

SUBJECT_SCHEMA = {
    "type": "object",
    "properties": {
        "subject": {"type": "string", "description": "The email's subject line."},
        "body": {"type": "string", "description": "The email text only, ready to send."},
    },
    "required": ["subject", "body"],
}

VOICE_SCHEMA = {
    "type": "object",
    "properties": {
        "said": {"type": "string", "description": "What they said in the recording, written down as said, in the language said."},
        "body": {"type": "string", "description": "The reply text only, ready to send."},
    },
    "required": ["said", "body"],
}
BUCKET = "attachments"
AUDIO_TYPES = {"ogg": "audio/ogg", "webm": "audio/webm", "m4a": "audio/mp4", "mp4": "audio/mp4", "wav": "audio/wav"}

# Checked offline against 35 replies the user really sent (email and WhatsApp, groups included): next to
# the email-only prompt before it, WhatsApp drafts stopped coming out as letters (email style 4 times to 0,
# formality right 30 to 35 of 35).
SYSTEM = """You write replies for one person, in their own voice, as if they wrote it themselves. The conversation is an email thread or a WhatsApp chat; the prompt says which.

- Write only the reply body: no subject line, no quoted text, no notes to them, no placeholders like [Name].
- Match how they actually write on this channel: greetings, sign-offs, length, punctuation, emoji and formality, taken from their examples and rules.
- When they have already written in this conversation (Me), their messages there decide the greeting, sign-off and register: use the same ones, even where a rule says otherwise. Their rules apply when they have not written here yet.
- Email: a proper email in their style, following their email rules on greetings, openers, paragraphs and sign-offs.
- WhatsApp: a chat message, not a letter. No greeting line, no "I hope you're doing well", no sign-off and no name at the end, unless their own WhatsApp messages do that. Usually one to three short lines; when they would send several short messages, put each on its own line. Their rules about greetings, sign-offs and paragraphs are about email and do not apply on WhatsApp.
- Keep to the length they would write: a short message gets a short answer.
- Reply in the language the conversation is in. When they mix languages (English with Afrikaans or isiZulu, say), mix as they do.
- Their examples, past messages and similar replies show how they write, never who this reply is to or what it is about. Never take a name, fact or detail from them. Greet the person by name only when "Replying to" gives one; otherwise greet without a name.
- Answer what the other person asked, and only that. Do not invent facts, dates, times, prices, plans or commitments, and do not add offers, next steps or promises to follow up they did not ask for. When something needs a decision only they can make, write the reply so it leaves that open or asks one short question.
- When you are told what they decided, the reply says exactly that, in their voice, and nothing that contradicts or goes beyond it.
- Plain text. No markdown, no emojis unless their own messages use them.
- Never use em dashes.""" + UNTRUSTED

COMPOSE_SYSTEM = """You write new messages for one person, in their own voice, as if they wrote it themselves. This starts a conversation: it is not a reply. The prompt says whether it is an email or a WhatsApp message.

- Say what their instruction says, in their voice. Do not invent facts, dates, times, prices, plans or commitments beyond it, and add no offers or next steps they did not ask for. When it leaves something open, leave it open.
- Match how they actually write on this channel: greetings, sign-offs, length, punctuation, emoji and formality, taken from their examples and rules.
- Email: a proper email in their style, and a subject: short, specific, in plain words, no "Re:" and no full stop.
- WhatsApp: a chat message, not a letter. No greeting line or sign-off unless their own WhatsApp messages have them.
- Their examples and past messages show how they write, never what this message is about. Never take a name, fact or detail from them. Greet the person by name only when "Writing to" gives one.
- Write in the language of their instruction, unless it says otherwise.
- Plain text. No markdown, no emojis unless their own messages use them, no placeholders like [Name].
- Never use em dashes.""" + UNTRUSTED

EDIT_SYSTEM = """You edit a message one person wrote themselves, before they send it. They want their own message back, lightly corrected, never rewritten.

- Fix spelling, grammar, punctuation and phrasing that is wrong or hard to follow. Change nothing else.
- Keep their words, sentence order, paragraphs, line breaks, length, greeting and sign-off. A sentence that is already fine stays exactly as written.
- Keep their voice and level of formality, as their examples and rules show it. Do not make it more polished or formal than they write.
- Never add anything: no new sentences, facts, offers, questions, pleasantries or sign-off. Never drop anything they said.
- Use the conversation and the details about this person only to check what they refer to, such as the spelling of a name.
- Never translate or anglicise. Afrikaans, isiZulu, isiXhosa, mixed languages, South African slang and chat shorthand (ja, lekker, now now, shot, tx) are correct as written.
- When they give an instruction for the edit, apply only that, still changing as little as possible.
- When the message needs no changes, return it exactly as it is.
- Plain text. No markdown. Never use em dashes.""" + UNTRUSTED

ADJUST_SYSTEM = """You adjust a reply one person is about to send, in their own voice. They asked for one change, given as "Change:". Make that change and nothing else.

- Keep every fact, date, time, price, name, commitment and question in it. Add none.
- Shorter means fewer words for the same message. More formal or more casual means the same message in another register, still clearly them.
- Keep their greeting, sign-off and punctuation habits, as their text, examples and rules show them, unless the change itself needs them different.
- When they also give an instruction, follow it.
- Plain text. No markdown, no emojis unless their own text or examples use them. Never use em dashes.""" + UNTRUSTED

TONES = {
    "default": "Their usual voice for this person.",
    "shorter": "Shorter than they would usually write: just what is needed.",
    "formal": "More formal than usual, still clearly them.",
    "casual": "More casual and relaxed than usual, still clearly them.",
}

# The same tones as a change to text that is already there. "Shorter" alone made the fast model cut the
# greeting, the thanks and the sign-off along with the padding.
ADJUSTMENTS = {
    "shorter": "Shorter: the same message in fewer words. Cut repetition and padding; keep the greeting, the sign-off and every point.",
    "formal": "More formal: the same message, more formal in wording, greeting and sign-off, still clearly them.",
    "casual": "More casual: the same message, more relaxed in wording, greeting and sign-off, still clearly them.",
}


def own_audio_path(user_id: Any, path: Any) -> bool:
    """True only for "<user id>/drafts/<name>" (more folders allowed) made of plain name characters. The row's
    audio_path is written by the app under row-level security that only checks the start of it, and this worker
    reads and deletes with the service role, so "<uid>/drafts/../../<other user>/x" must never get through."""
    if not user_id or not isinstance(path, str):
        return False
    return re.fullmatch(re.escape(str(user_id)) + r"/drafts/[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*", path) is not None and not {"..", "."} & set(path.split("/"))


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
    edit: str | None = None,
    spoken: bool = False,
    channel: str = "email",
    group_name: str = "",
    subject: str = "",
    last_from_me: bool = False,
    facts: list[tuple[str, str]] | None = None,
    compose: bool = False,
    company: dict[str, Any] | None = None,
) -> str:
    """You first (the same for every draft on this channel, so Gemini can bill it at the cached rate), then
    this person, then the conversation, and what you asked for last. With edit, the end is your own text
    to correct. company is the team's voice for a work chat (company_voice.py), placed under your own rules and
    facts and before your examples; a personal chat has none, and its prompt is unchanged."""
    medium = "WhatsApp" if channel == "whatsapp" else "email"
    noun = "messages" if channel == "whatsapp" else "emails"
    lines = [f"You are writing as: {me or 'the user'}", f"About them: {about or 'not given'}"]
    if rules:
        lines += ["", "Rules learned from their sent mail and how they edit drafts:"] + [f"- {r}" for r in rules]
    if facts:
        lines += ["", "Facts they keep for replies (use one only when the reply needs it, and quote figures exactly):"]
        lines += [f"[{title or 'Note'}]\n{body}\n" for title, body in facts]
    lines += company_lines(company)
    if examples:
        lines += ["", "Examples they saved:"] + [f"[{situation}]\n{body}\n" for situation, body in examples]
    if recent:
        lines += ["", f"Their own recent sent {medium} {noun} (for voice, not content):"] + [f"---\n{v}" for v in recent]
    # With no name, the model would fill a "Hi [Name]" rule with a name from the examples, so it is told.
    replying = them or "someone whose name is not known. Greet them without a name, for example 'Hi,'"
    lines += ["", f"{'Writing to' if compose else 'Replying to'}: {replying}", f"Relationship: {relationship or 'unknown'}"]
    if who_they_are:
        lines.append(f"Who this person is: {who_they_are}")
    if style_note:
        lines.append(f"How they write to this person: {style_note}")
    if person_rules:
        lines += ["", "Rules for writing to this person:"] + [f"- {r}" for r in person_rules]
    if more_voice:
        lines += ["", f"More of their own sent {medium} {noun}, to this person first (for voice, not content):"] + [f"---\n{v}" for v in more_voice]
    if similar:
        lines += ["", "How they answered similar messages before (for voice and approach, not facts):"]
        lines += [f"--- They received:\n{inbound}\n--- They replied:\n{reply}" for inbound, reply in similar]
    where = f"WhatsApp group chat: {group_name}" if group_name else ("WhatsApp chat" if channel == "whatsapp" else "Email")
    lines += ["", f"Channel: {where}"]
    if subject and channel != "whatsapp":
        lines.append(f"Subject: {subject}")
    if compose:
        lines.append(f"A new {medium} message, not a reply: there is no conversation yet.")
    else:
        thread = "\n".join(f"--- {who}:\n{text}" for who, text in conversation)
        lines += ["", "The conversation, oldest first (Me is them), between the marked lines:", fenced(thread, new_fence(thread))]
    if edit is not None and is_adjust(tone):
        lines += ["", "The reply they have now, to adjust:", f"---\n{edit}\n---", f"Change: {ADJUSTMENTS[tone]}"]
        if instruction:
            lines.append(f"Their instruction for this reply: {instruction}")
        lines.append("\nReturn the reply with only that change.")
        return "\n".join(lines)
    if edit is not None:
        lines += ["", "The reply they wrote themselves, to edit:", f"---\n{edit}\n---"]
        if instruction:
            lines.append(f"Their instruction for this edit: {instruction}")
        lines.append("\nReturn their reply with only the light edits it needs.")
        return "\n".join(lines)
    lines += ["", f"Tone: {TONES.get(tone, TONES['default'])}"]
    if decision:
        lines.append(f"What they decided to say: {decision}")
    if instruction:
        lines.append(f"Their instruction for this reply: {instruction}")
    if spoken:
        lines.append("What they want this reply to say is in their recording, in their own words; it may be rough or rambling. Follow it, and write down what they said.")
    if compose:
        to = f" to {them}" if them else ""
        lines.append(f"\nWrite their new {medium} message{to}" + (", with its subject." if channel != "whatsapp" else "."))
    elif last_from_me:
        # Asked to reply to "the last message", the model answered their own message back to them.
        lines.append(f"\nThe last message is their own. Write the next {medium} message they would send: a short follow-up that adds to what they said, never a reply to themselves.")
    else:
        sender = conversation[-1][0] if conversation and conversation[-1][0] not in ("Them", "Me") else "the other person"
        lines.append(f"\nWrite their {medium} reply to the latest message from {sender}.")
    return "\n".join(lines)


def schema_for(*, voice: bool, subject: bool) -> dict[str, Any]:
    """The answer's shape: the text, with what was said in a recording, and an email's subject."""
    if not voice and not subject:
        return SCHEMA
    props = dict((SUBJECT_SCHEMA if subject else SCHEMA)["properties"])
    if voice:
        props = {"said": VOICE_SCHEMA["properties"]["said"], **props}
    return {"type": "object", "properties": props, "required": list(props)}


def is_adjust(tone: str | None) -> bool:
    """Shorter, More Formal or More Casual: with source, a change to the text in the reply box."""
    return tone in ADJUSTMENTS


def revises(d: dict[str, Any]) -> bool:
    """An edit or adjustment of the text in your reply box, rather than a draft written afresh."""
    return bool((d.get("source") or "").strip()) and (d.get("tone") == "edit" or is_adjust(d.get("tone")))


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


class Drafts:
    def __init__(
        self,
        db: Supabase,
        gemini: Gemini,
        model: str,
        embeddings: Embeddings | None = None,
        vault: Vault | None = None,
        fast_model: str | None = None,
        predraft_model: str | None = None,
    ):
        self.db = db
        self.gemini = gemini
        self.model = model
        self.fast_model = fast_model or model  # edits and adjustments: a small change to text that is already there
        self.predraft_model = predraft_model or model  # automatic pre-drafts, which nobody is waiting on
        self.embeddings = embeddings
        self.vault = vault or Vault(db)  # without one, plaintext passes through and nothing is encrypted
        self._runner = ThreadPoolExecutor(max_workers=MAX_RUNNING, thread_name_prefix="draft")
        self._calls = ThreadPoolExecutor(max_workers=MAX_RUNNING * 2, thread_name_prefix="draft-call")
        self._lock = threading.Lock()
        self._running: dict[str, str] = {}  # draft id -> thread id, while it is being written
        self._attempts: dict[str, int] = {}
        self._swept = 0.0
        self._audio_swept = 0.0
        self._hold_until = 0.0  # time.monotonic: pending drafts are not looked for before this (billing paused)
        self._active_until = 0.0
        self._idle = Backoff(POLL_IDLE_S, POLL_IDLE_MAX_S, 1.5)

    def poll_wait(self) -> float:
        """Seconds until the next check: sooner while drafts are being asked for."""
        busy = self._running or time.monotonic() < self._active_until
        if busy:
            self._idle.reset()
            return POLL_ACTIVE_S
        return self._idle.next(False)  # 1.5s, then longer each look, up to POLL_IDLE_MAX_S

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
        if time.monotonic() - self._audio_swept >= AUDIO_SWEEP_EVERY_S:
            self._audio_swept = time.monotonic()
            # Recordings are kept only until their draft is written: one whose draft never was goes too.
            left = self.db.select("drafts", {"select": "id,user_id,status,audio_path", "status": "neq.pending", "audio_path": "not.is.null", "limit": "50"})
            left = [r for r in left if r.get("audio_path") and r.get("status") != "pending"]
            if left:
                self.db.remove_files(BUCKET, [r["audio_path"] for r in left if own_audio_path(r.get("user_id"), r["audio_path"])])
                self.db.update("drafts", {"id": in_list([r["id"] for r in left])}, {"audio_path": None}, minimal=True)
        if time.monotonic() < self._hold_until:
            return 0
        with self._lock:
            running = dict(self._running)
        if len(running) >= MAX_RUNNING:
            return 0
        pending = self.db.select(
            "drafts",
            {
                "select": "id,user_id,thread_id,account_id,contact_id,tone,instruction,decision,source,auto,for_message_id,audio_path",
                "status": "eq.pending",
                "order": "auto,created_at",  # drafts people asked for first, then pre-drafts
                "limit": str(MAX_RUNNING * 2),
                **not_in(list(running)),
            },
        )
        if pending:
            self._active_until = time.monotonic() + ACTIVE_FOR_S
        for d in pending:
            self.vault.open_row(d["user_id"], d, [("instruction", INSTRUCTION), ("decision", INSTRUCTION), ("source", DRAFT)])
        started = pick_drafts(pending, running, MAX_RUNNING - len(running))
        started = [d for d in started if not self._limited(d)]
        warm = getattr(self.gemini, "warm", None)
        if started and warm:  # the connection is ready by the time draft_context has been read
            threading.Thread(target=warm, args=(self.fast_model if all(revises(d) for d in started) else self.model,), daemon=True).start()
        for d in started:
            with self._lock:
                self._running[d["id"]] = d["thread_id"] or d["id"]
            self._runner.submit(self._run, d)
        return len(started)

    def _limited(self, d: dict[str, Any]) -> bool:
        """True, and the draft failed, when this conversation has had its share of drafts: at most
        regen_per_hour that a person asked for in the past hour, and auto_drafts_per_day pre-drafts in the past
        day (both set in the admin panel). Drafts that failed for any reason do not count. A new message
        has no conversation, so it is limited per person instead (COMPOSE_PER_HOUR)."""
        thread = d.get("thread_id")
        if not thread:
            return self._compose_limited(d)
        limits = self.gemini.limits() if hasattr(self.gemini, "limits") else DEFAULT_LIMITS
        auto = bool(d.get("auto"))
        since = datetime.now(timezone.utc) - (timedelta(days=1) if auto else timedelta(hours=1))
        try:
            made = self.db.count(
                "drafts",
                {
                    "thread_id": f"eq.{thread}",
                    "auto": "is.true" if auto else "is.false",
                    "status": "not.in.(pending,failed,expired)",
                    "created_at": f"gte.{since.isoformat()}",
                },
            )
        except Exception as err:  # never hold drafts up over the count
            log.warn("draft limit not checked", code=log.code_of(err))
            return False
        if made < limits["auto_drafts_per_day" if auto else "regen_per_hour"]:
            return False
        if auto:
            self._expire(d)  # nobody asked for it, so there is nothing to tell them
        else:
            self._fail(d, "You have asked for a lot of drafts on this conversation. Try again in a little while.")
        log.info("draft limited", draft=d["id"], auto=auto)
        return True

    def _compose_limited(self, d: dict[str, Any]) -> bool:
        """A new message has no conversation, so its limit is per person: COMPOSE_PER_HOUR in the past hour, not
        counting ones that failed. Fails the draft with a plain message when over."""
        since = datetime.now(timezone.utc) - timedelta(hours=1)
        try:
            made = self.db.count(
                "drafts",
                {
                    "user_id": f"eq.{d['user_id']}",
                    "thread_id": "is.null",
                    "auto": "is.false",
                    "status": "not.in.(pending,failed,expired)",
                    "created_at": f"gte.{since.isoformat()}",
                },
            )
        except Exception as err:  # never hold drafts up over the count
            log.warn("compose limit not checked", code=log.code_of(err))
            return False
        if made < COMPOSE_PER_HOUR:
            return False
        self._fail(d, "You have asked for a lot of drafts. Try again in a little while.")
        log.info("compose draft limited", draft=d["id"])
        return True

    def _run(self, d: dict[str, Any]) -> None:
        try:
            self._draft(d)
            self._attempts.pop(d["id"], None)
        except Exception as err:
            # A database or network error mid-draft: the next check tries again, a couple of times, then stops.
            attempts = self._attempts.get(d["id"], 0) + 1
            self._attempts[d["id"]] = attempts
            log.warn("draft error", draft=d["id"], attempts=attempts, code=log.code_of(err))
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

    def _expire(self, d: dict[str, Any]) -> None:
        self.db.update("drafts", {"id": f"eq.{d['id']}", "status": "eq.pending"}, {"status": "expired", "updated_at": _now()}, minimal=True)

    def _gather(self, d: dict[str, Any]) -> dict[str, Any] | str | None:
        """Everything the prompt needs, the reason the draft cannot be written, or None for a pre-draft
        that is no longer wanted. Reads only: one call to public.draft_context, plus an embedding and a
        search when the email has no vector yet."""
        user = d["user_id"]
        first = self.db.rpc("draft_context", {"p_user": user, "p_thread": d["thread_id"]}) or {}
        thread = first.get("thread")
        # The draft row is the user's; the thread must be theirs too, or nothing read is used.
        if not thread or thread["user_id"] != user:
            return "This conversation could not be found."
        # Opened before anything reads them, the embedding of latest_in for similar replies included.
        self.vault.open_row(user, thread, [("subject", SUBJECT), ("group_name", NAME)])
        for m in first["messages"]:
            self.vault.open_row(user, m, [("subject", SUBJECT), ("body_text", BODY), ("body_html", HTML), ("transcript", TRANSCRIPT)])
            if isinstance(m.get("quoted"), dict):
                m["quoted"]["text"] = self.vault.open(user, QUOTE, m["quoted"].get("text"))
            if m.get("transcript"):  # a voice note is read as what was said in it
                m["body_text"] = f"(Voice note) {m['transcript']}\n\n{m.get('body_text') or ''}".strip()
                m["body_html"] = None
        for m in first["recent"] + (first.get("to_them") or []):
            self.vault.open_row(user, m, [("body_text", BODY), ("body_html", HTML)])
        if d.get("auto") and stale(d, first["messages"], self.vault.open(user, CHOICES, first.get("choices"))):
            return None
        messages = first["messages"][::-1]
        edit = (d.get("source") or "").strip() if d.get("tone") == "edit" or (is_adjust(d.get("tone")) and d.get("source") is not None) else None
        if edit == "":
            return "There is nothing to edit yet."
        if not messages:
            return "There is nothing to reply to yet."

        contact = first.get("contact") or {}
        latest_in = next((m for m in reversed(messages) if m["direction"] == "inbound"), None)
        similar = self._similar(user, thread, latest_in)
        names = {cid: self.vault.open(user, NAME, name) for cid, name in (first.get("senders") or {}).items()}
        if contact:
            names.setdefault(contact.get("id"), contact.get("display_name"))

        conversation = []
        for i, m in enumerate(messages):
            who = "Them" if m["direction"] == "inbound" else "Me"
            if m["direction"] == "inbound" and m.get("sender_contact_id") in names:
                who = names[m["sender_contact_id"]] or "Them"
            conversation.append((who, describe(m, 1500 if i >= len(messages) - 2 else OLDER_CHARS)))

        # The team's voice is for a new draft in a work chat. An edit or adjustment only corrects their own text.
        company = self._company(user, d["thread_id"]) if edit is None else None
        return {
            "thread": thread,
            "prompt": build_prompt(
                **self._you(user, first, similar),
                conversation=conversation,
                tone=d.get("tone") or "default",
                instruction=d.get("instruction"),
                decision=d.get("decision"),
                edit=edit,
                spoken=bool(d.get("audio_path")) and edit is None,
                channel=thread.get("channel") or "email",
                group_name=(thread.get("group_name") or "WhatsApp group") if thread.get("is_group") else "",
                subject=thread.get("subject") or "",
                last_from_me=messages[-1]["direction"] == "outbound",
                company=company,
            ),
            "edit": edit is not None,
            "company": company is not None,
        }

    def _company(self, user: str, thread_id: str) -> dict[str, Any] | None:
        """The team's voice for this chat, opened, or None. The database only returns it for a work chat (or a shared
        inbox chat) of the person's own team, so a personal chat gets nothing; someone in no team never asks. Never
        fails the draft: when it cannot be read the draft is written without it."""
        try:
            if not self.vault.workspaces_for(user):
                return None
            got = self.db.rpc("company_voice_for_draft", {"p_user": user, "p_thread": thread_id})
            if not isinstance(got, dict) or not got.get("workspace_id"):
                return None
            workspace = got["workspace_id"]
            return pick_company(got.get("items") or [], lambda field, value: self.vault.open(user, field, value, workspace) or "")
        except Exception as err:
            log.warn("company voice not read", thread=thread_id, code=log.code_of(err))
            return None

    def _you(self, user: str, first: dict[str, Any], similar: list[tuple[str, str]]) -> dict[str, Any]:
        """The parts of the prompt about you and the person, from draft_context or compose_context."""
        profile = first.get("profile") or {}
        contact = first.get("contact") or {}
        contact_id = contact.get("id")
        org = contact.get("organizations") or {}
        recent = pick_voice([], first["recent"], limit=RECENT_VOICE)
        opened = lambda field, value: self.vault.open(user, field, value) or ""  # sealed or plain
        rules = [{**r, "rule": opened(STYLE_RULE, r.get("rule"))} for r in first["rules"]]
        return {
            "me": profile.get("display_name") or "",
            "about": profile.get("about") or "",
            "rules": [r["rule"] for r in rules if r["scope"] == "global" and r["rule"]][:20],
            "examples": [(opened(WRITING_SITUATION, e.get("situation")), opened(WRITING_BODY, e.get("body"))) for e in first["examples"]],
            "recent": recent,
            "facts": pick_facts([(self.vault.open(user, NOTE_TITLE, f.get("title")) or "", self.vault.open(user, NOTE, f.get("body")) or "") for f in first.get("facts") or []]),
            "them": self.vault.open(user, NAME, contact.get("display_name")) or "",
            "relationship": opened(CONTACT_RELATIONSHIP, contact.get("relationship")),
            "style_note": opened(CONTACT_STYLE_NOTE, contact.get("style_note")),
            "who_they_are": opened(CONTACT_SUMMARY, contact.get("ai_summary")) or (f"{org['name']}: {org['summary']}" if org.get("summary") else ""),
            "person_rules": [r["rule"] for r in rules if contact_id and r["scope"] == "contact" and r.get("contact_id") == contact_id and r["rule"]][:10],
            "more_voice": pick_more_voice(first.get("to_them") or [], first["recent"], shown=recent, similar=similar),
            "similar": similar,
        }

    def _gather_compose(self, d: dict[str, Any]) -> dict[str, Any] | str:
        """A new message's prompt, from public.compose_context: no conversation, so no similar replies."""
        user = d["user_id"]
        first = self.db.rpc("compose_context", {"p_user": user, "p_account": d.get("account_id"), "p_contact": d.get("contact_id")}) or {}
        account = first.get("account")
        if not account or account["user_id"] != user:
            return "This account could not be found."
        for m in first["recent"] + (first.get("to_them") or []):
            self.vault.open_row(user, m, [("body_text", BODY), ("body_html", HTML)])
        edit = (d.get("source") or "").strip() if d.get("tone") == "edit" or (is_adjust(d.get("tone")) and d.get("source") is not None) else None
        if edit == "":
            return "There is nothing to edit yet."
        if edit is None and not (d.get("instruction") or "").strip() and not d.get("audio_path"):
            return "Say what the message should say first."
        channel = account.get("channel") or "email"
        return {
            "thread": {"id": None, "account_id": account["id"]},
            "prompt": build_prompt(
                **self._you(user, first, []),
                conversation=[],
                tone=d.get("tone") or "default",
                instruction=d.get("instruction"),
                edit=edit,
                spoken=bool(d.get("audio_path")) and edit is None,
                channel=channel,
                compose=True,
            ),
            "edit": edit is not None,
            "subject": channel == "email" and edit is None,
        }

    def _draft(self, d: dict[str, Any]) -> None:
        try:
            self._write(d)
        finally:
            if d.get("audio_path"):  # heard or not, a recording is not kept once its draft is done
                if own_audio_path(d.get("user_id"), d["audio_path"]):
                    self.db.remove_files(BUCKET, [d["audio_path"]])
                self.db.update("drafts", {"id": f"eq.{d['id']}"}, {"audio_path": None}, minimal=True)

    def _recording(self, d: dict[str, Any]) -> tuple[bytes, str] | None:
        """The recording of what the draft should say, opened, with its type; None if it cannot be read."""
        if not own_audio_path(d.get("user_id"), d["audio_path"]):
            log.warn("draft recording path refused", draft=d["id"])
            return None
        try:
            data = self.vault.open_bytes(d["user_id"], VOICE_INSTRUCTION, self.db.download(BUCKET, d["audio_path"]))
        except Exception as err:
            log.warn("draft recording unavailable", draft=d["id"], code=log.code_of(err))
            return None
        ext = d["audio_path"].rsplit(".", 1)[-1].lower()
        return (data, AUDIO_TYPES.get(ext, "audio/webm")) if data else None

    def _write(self, d: dict[str, Any]) -> None:
        gathered = self._gather(d) if d.get("thread_id") else self._gather_compose(d)
        if gathered is None:
            self._expire(d)
            log.info("pre-draft dropped", draft=d["id"])
            return
        if isinstance(gathered, str):
            self._fail(d, gathered)
            return
        thread, prompt, edit, subject = gathered["thread"], gathered["prompt"], gathered["edit"], gathered.get("subject", False)
        compose = thread["id"] is None
        adjust = edit and is_adjust(d.get("tone"))
        model = self.fast_model if edit else self.predraft_model if d.get("auto") else self.model
        audio = self._recording(d) if d.get("audio_path") and not edit else None
        if d.get("audio_path") and not edit and audio is None:
            self._fail(d, "The recording could not be read. Try again.")
            return
        try:
            result = self._hedged(lambda: self.gemini.json(
                model,
                ADJUST_SYSTEM if adjust else EDIT_SYSTEM if edit else COMPOSE_SYSTEM if compose else SYSTEM + COMPANY_SYSTEM if gathered.get("company") else SYSTEM,
                prompt,
                schema_for(voice=audio is not None, subject=subject),
                UsageContext(d["user_id"], "draft", thread["account_id"], thread["id"]),
                temperature=0.4 if adjust else 0.2 if edit else 0.6,  # an edit should come back the same way each time
                # On low the fast model let typos in all-lowercase text through; medium caught them in 2 to 5s,
                # where the full model took 2 to 17s.
                thinking=edit_thinking() if edit and not adjust else draft_thinking(),
                attempts=3,  # someone is waiting: fail and let them try again rather than wait minutes
                timeout=60,
                max_output=DRAFT_MAX_OUTPUT,
                audio=audio,
            ), hedge=audio is None and hedge_on())
        except GeminiError as err:
            if billing_paused(err):  # the draft stays pending and is written once the pause ends (or fails as stale)
                self._hold_until = time.monotonic() + BILLING_HOLD_S
                log.warn("draft held", draft=d["id"])
                return
            log.warn("draft failed", draft=d["id"], status=err.status)
            self._fail(d, "The draft could not be written. Try again.")
            return

        body = (result.get("body") or "").replace("—", ", ").replace("–", "-").strip()
        if edit:
            body = keep_quotes(d.get("source") or "", body)
        if not body:
            self._fail(d, "The draft came back empty. Try again.")
            return
        done: dict[str, Any] = {"body": self.vault.seal(d["user_id"], DRAFT, body), "status": "active", "model": model, "error": None, "updated_at": _now()}
        title = (result.get("subject") or "").replace("\n", " ").replace("—", ", ").strip()[:200] if subject else ""
        if title:
            done["subject"] = self.vault.seal(d["user_id"], SUBJECT, title)
        said = (result.get("said") or "").strip() if audio else ""
        if said:  # what you said becomes the instruction, so the app shows it and another try reuses it
            done["instruction"] = self.vault.seal(d["user_id"], INSTRUCTION, said[:1000])
        written = self.db.update("drafts", {"id": f"eq.{d['id']}", "status": "eq.pending"}, done)
        if not written:
            # The app gave up waiting and withdrew it, so the draft it already shows (if any) stays.
            log.info("draft withdrawn", draft=d["id"])
            return
        if compose:  # a new message has no conversation, and the dialog keeps its own draft
            log.info("draft written", draft=d["id"])
            return
        # One live draft per conversation: older ones are replaced. One you asked for again was turned
        # down; one a pre-draft replaces answered an older message, and is only out of date; one you
        # edited or adjusted was kept and worked on.
        self.db.update(
            "drafts",
            {"thread_id": f"eq.{thread['id']}", "status": "eq.active", "id": f"neq.{d['id']}"},
            {"status": "expired" if d.get("auto") else "revised" if revises(d) else "discarded", "updated_at": _now()},
            minimal=True,
        )
        log.info("draft written", draft=d["id"])

    def _hedged(self, call: Any, *, hedge: bool = True) -> dict[str, Any]:
        """call(), and when it has not answered after HEDGE_AFTER_S, the same call again: whichever answers
        first is used. A slow model call (8 to 10s were seen against a usual 2.6s) then costs a few seconds
        instead of the whole wait. The slower one still finishes and is billed, about one draft in ten."""
        first: Future = self._calls.submit(call)
        if not hedge:
            return first.result()
        done, _ = wait([first], timeout=HEDGE_AFTER_S)
        if done:
            return first.result()
        second: Future = self._calls.submit(call)
        racing = {first, second}
        while racing:
            done, racing = wait(racing, return_when=FIRST_COMPLETED)
            for f in done:
                if f.exception() is None:
                    return f.result()
        return first.result()  # both failed: the first one's error

    def _similar(self, user: str, thread: dict[str, Any], latest_in: dict[str, Any] | None) -> list[tuple[str, str]]:
        """How you answered the emails most like the one being answered, from other conversations. The search
        runs here over the user's opened vectors (similar.py), never in the database: the email's own vector
        is read back when it is stored (mail is embedded once answered), else it is embedded now. Never fails
        the draft: without embeddings it returns nothing and the recent mail is used."""
        if not latest_in or not latest_in.get("id") or self.embeddings is None:
            return []
        try:
            values = self.embeddings.stored(user, latest_in["id"])
            if values is None:
                values = self.embeddings.for_message(latest_in, user, thread.get("account_id"), thread["id"])
            if values is None:
                return []
            rows = self.embeddings.index.replies(user, values, thread["id"], SIMILAR_LIMIT * 2)
        except Exception as err:
            log.warn("similar replies unavailable", thread=thread["id"], code=log.code_of(err))
            return []
        for r in rows:  # both texts are messages.body_text, so both open as BODY
            self.vault.open_row(user, r, [("inbound_subject", SUBJECT), ("inbound_text", BODY), ("reply_text", BODY)])
        return pick_similar(rows, thread["id"])


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
