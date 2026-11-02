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
import threading
import time
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from datetime import datetime, timezone
from typing import Any

from . import actions, log
from .company_voice import COMPANY_SYSTEM
from .config import edit_thinking, draft_thinking
from .drafts_context import (  # noqa: F401  re-exported: other modules and tests import these from here
    AUDIO_SWEEP_EVERY_S,
    BILLING_HOLD_S,
    COMPOSE_PER_HOUR,
    DRAFT_MAX_OUTPUT,
    FACT_CHARS,
    FACTS_CHARS,
    MAX_ATTEMPTS,
    MAX_VOICE,
    MIN_SIMILARITY,
    OLDER_CHARS,
    RECENT_VOICE,
    SIMILAR_IN_CHARS,
    SIMILAR_LIMIT,
    SIMILAR_OUT_CHARS,
    STALE_AFTER,
    SWEEP_EVERY_S,
    TO_THEM_VOICE,
    VOICE_CHARS,
    MEDIA,
    _now,
    describe,
    keep_quotes,
    own_audio_path,
    pick_drafts,
    pick_facts,
    pick_more_voice,
    pick_similar,
    pick_voice,
    stale,
)
from .drafts_facts import RETRY_TEMPERATURE, check, needs_retry, retry_note
from .drafts_gather import GatherMixin
from .drafts_prompt import (  # noqa: F401  re-exported: other modules and tests import these from here
    ADJUST_SYSTEM,
    ADJUSTMENTS,
    COMPOSE_SYSTEM,
    EDIT_SYSTEM,
    SCHEMA,
    SUBJECT_SCHEMA,
    SYSTEM,
    TONES,
    VOICE_SCHEMA,
    build_prompt,
    is_adjust,
    revises,
    schema_for,
)
from .embed import Embeddings
from .fields import DRAFT, INSTRUCTION, SUBJECT, VOICE_INSTRUCTION
from .gemini import Gemini, GeminiError, UsageContext
from .poll import Backoff
from .retry import billing_paused, not_in
from .supabase import Supabase, in_list
from .text import plain_dashes
from .vault import Vault

MAX_RUNNING = 4
DRAFT_TEMPERATURE = 0.6  # a fresh draft; the fact guard asks again at drafts_facts.RETRY_TEMPERATURE when it finds unsupported details
HEDGE_AFTER_S = 4.5  # past the model's p90 (about 3.3s on a draft): a second request is sent and the first answer used


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
BUCKET = "attachments"
AUDIO_TYPES = {"ogg": "audio/ogg", "webm": "audio/webm", "m4a": "audio/mp4", "mp4": "audio/mp4", "wav": "audio/wav"}


class Drafts(GatherMixin):
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

    claims = None  # a claims.Claims, set by the entry point: the second-worker guard

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
        if self.claims and started:  # a second AI worker never writes (and pays for) the same draft
            got = self.claims.claim("draft", [d["id"] for d in started])
            started = [d for d in started if d["id"] in got]
        warm = getattr(self.gemini, "warm", None)
        if started and warm:  # the connection is ready by the time draft_context has been read
            threading.Thread(target=warm, args=(self.fast_model if all(revises(d) for d in started) else self.model,), daemon=True).start()
        for d in started:
            with self._lock:
                self._running[d["id"]] = d["thread_id"] or d["id"]
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
            if self.claims:
                self.claims.release("draft", [d["id"]])
            self._active_until = time.monotonic() + ACTIVE_FOR_S

    def _fail(self, d: dict[str, Any], reason: str) -> None:
        self.db.update("drafts", {"id": f"eq.{d['id']}"}, {"status": "failed", "error": reason, "updated_at": _now()}, minimal=True)

    def _expire(self, d: dict[str, Any]) -> None:
        self.db.update("drafts", {"id": f"eq.{d['id']}", "status": "eq.pending"}, {"status": "expired", "updated_at": _now()}, minimal=True)

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
        # A next step (book, task, file, template) may ride on a fresh reply draft; edits, adjustments and new messages get none.
        offer = actions.gather(self.db, self.vault, d["user_id"], thread["id"]) if not edit and not compose else None
        if offer is not None:
            prompt += actions.prompt_block(offer, d["id"])
        audio = self._recording(d) if d.get("audio_path") and not edit else None
        if d.get("audio_path") and not edit and audio is None:
            self._fail(d, "The recording could not be read. Try again.")
            return
        system = ADJUST_SYSTEM if adjust else EDIT_SYSTEM if edit else COMPOSE_SYSTEM if compose else SYSTEM + COMPANY_SYSTEM if gathered.get("company") else SYSTEM
        if offer is not None:
            system += actions.ACTION_SYSTEM

        def ask(text: str, temperature: float) -> dict[str, Any]:
            return self._hedged(lambda: self.gemini.json(
                model,
                system,
                text,
                actions.with_action(schema_for(voice=audio is not None, subject=subject)) if offer is not None else schema_for(voice=audio is not None, subject=subject),
                UsageContext(d["user_id"], "draft", thread["account_id"], thread["id"]),
                temperature=temperature,
                # On low the fast model let typos in all-lowercase text through; medium caught them in 2 to 5s,
                # where the full model took 2 to 17s.
                thinking=edit_thinking() if edit and not adjust else draft_thinking(),
                attempts=3,  # someone is waiting: fail and let them try again rather than wait minutes
                timeout=60,
                max_output=DRAFT_MAX_OUTPUT,
                audio=audio,
            ), hedge=audio is None and hedge_on())

        report: dict[str, Any] | None = None
        try:
            result = ask(prompt, 0.4 if adjust else 0.2 if edit else DRAFT_TEMPERATURE)  # an edit should come back the same way each time
            if not edit:  # your own text is not checked: it is yours
                report = self._checked(result, gathered)
                if needs_retry(report):
                    # A detail that is in nothing the draft was written from, or a placeholder: one more try, colder.
                    # The better of the two is kept; a failed second try keeps the first.
                    log.info("draft facts unsupported", draft=d["id"], missing=report["missing"])
                    try:
                        again = ask(prompt + retry_note(report), RETRY_TEMPERATURE)
                        second = self._checked(again, gathered)
                        if second["missing"] <= report["missing"]:
                            result, report = again, second
                    except GeminiError:
                        pass
        except GeminiError as err:
            if billing_paused(err):  # the draft stays pending and is written once the pause ends (or fails as stale)
                self._hold_until = time.monotonic() + BILLING_HOLD_S
                log.warn("draft held", draft=d["id"])
                return
            log.warn("draft failed", draft=d["id"], status=err.status)
            self._fail(d, "The draft could not be written. Try again.")
            return

        body = plain_dashes(result.get("body")).strip()
        if edit:
            body = keep_quotes(d.get("source") or "", body)
        if not body:
            self._fail(d, "The draft came back empty. Try again.")
            return
        done: dict[str, Any] = {"body": self.vault.seal(d["user_id"], DRAFT, body), "status": "active", "model": model, "error": None, "updated_at": _now()}
        if report is not None:
            # The report names details from the draft, so it is sealed as the draft is; the audit is counts only.
            done["report"] = self.vault.seal(d["user_id"], DRAFT, json.dumps(report, separators=(",", ":")))
            done["audit"] = gathered.get("audit")
        title = plain_dashes((result.get("subject") or "").replace("\n", " ")).strip()[:200] if subject else ""
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
        if offer is not None:
            actions.propose(self.db, self.vault, d["user_id"], thread["id"], d["id"], result.get("action"), offer)
        log.info("draft written", draft=d["id"])

    def _checked(self, result: dict[str, Any], gathered: dict[str, Any]) -> dict[str, Any]:
        """The fact report for a model answer: its body against everything it was written from, and what the person
        said into a recording (which is part of what the draft may rightly state)."""
        spoken = (result.get("said") or "") if isinstance(result.get("said"), str) else ""
        return check(plain_dashes(result.get("body")), list(gathered.get("evidence") or []) + [spoken])

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
