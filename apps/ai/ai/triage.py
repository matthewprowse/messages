"""Triage: priority, category, junk and a one-line summary for each new incoming message.

The model decides first, then your own signals win: priority rules, senders you unsubscribed from,
and the Important / Not Important / Junk / Not Junk corrections you made in the app. Conversations
with triage turned off (WhatsApp groups start that way) are skipped.

The model is only asked when its answer is used. A conversation takes the triage of its latest
incoming message, so an older one in a conversation that has a newer one is recorded without a model
call; so is mail from a sender you unsubscribed from or in a conversation you marked Junk, a bulk
sender the model has labelled the same junk way every time lately (sender_outcome), and an
email already triaged in another of your accounts (the same Message-ID) is copied. The rest go to
the fast model GROUP at a time, per account, with minimal thinking: the instructions and what is
known about you are sent once for the group, first, so they are the same at the start of every call.

Each email goes with up to CONTEXT_MESSAGES earlier messages of its conversation, both directions, cut short, so
the model can tell an open question from one already answered (bulk mail gets none).

The same call offers guided drafting's one-tap choices for a message that needs a decision only you
can make ("Are you free Thursday at 3?"). Messages triaged before that existed get theirs when there
is nothing new to triage (backfill_choices), only while they still need a reply."""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from . import log
from .analytics import Analytics, event, prompt_id, traits as message_traits
from .fields import ADDRESS, BODY, CHOICES, CONTACT_RELATIONSHIP, FILENAME, HTML, SUBJECT, SUMMARY, TRANSCRIPT, UNSUBSCRIBE
from .billing import is_billing_paused
from .gemini import Gemini, GeminiError, UsageContext
from .retry import Backoff, billing_paused, not_in
from .supabase import Supabase, in_list
from .text import clean
from .triage_context import ContextMixin
from .triage_prompt import (  # noqa: F401  re-exported: other modules and tests import these from here
    LANGUAGE_NAMES,
    SCHEMA,
    SYSTEM,
    earlier_lines,
    earlier_messages,
    read_choices,
    read_results,
    sent_label,
    triage_prompt,
)
from .triage_signals import (  # noqa: F401  re-exported: other modules and tests import these from here
    BATCH,
    BODY_CHARS,
    BULK_BODY_CHARS,
    BULK_CATEGORIES,
    CATEGORIES,
    CONTEXT_CHARS,
    CONTEXT_MESSAGES,
    CONTEXT_TTL_S,
    GROUP,
    LATEST_ROWS,
    LOOKBACK_DAYS,
    MAX_OPTIONS,
    NO_CHOICES,
    OPTION_KINDS,
    PRIORITIES,
    SENDER_KEEP,
    SENDER_RECHECK_DAYS,
    SUBJECT_CHARS,
    VOICE_RECHECK_S,
    VOICE_WAIT_S,
    UserContext,
    apply_signals,
    groups,
    known_outcome,
    latest_incoming,
    matches,
    pending_query,
    sender_outcome,
    superseded_outcome,
)
from .vault import Vault


class Triage(ContextMixin):
    def __init__(self, db: Supabase, gemini: Gemini, model: str, vault: Vault | None = None):
        self.db = db
        self.gemini = gemini
        self.model = model
        self.vault = vault or Vault(db)  # without one, plaintext passes through and nothing is encrypted
        self.analytics = Analytics(db)
        self._backoff = Backoff()
        self._voice_wait: dict[str, float] = {}  # voice notes waiting for their transcript -> monotonic time to look again
        self._pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="triage")
        self._users: dict[str, tuple[float, UserContext]] = {}  # user_id -> (read at, context)

    def _without_untranscribed(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Holds back a voice note until it is transcribed, so triage, the summary and the daily brief know
        what was said. One whose file has not arrived, or could not be transcribed, is triaged without it
        after VOICE_WAIT_S."""
        now = time.monotonic()
        keep = []
        for r in rows:
            voice = any((self.vault.open(r["user_id"], FILENAME, a.get("filename")) or "").startswith("Voice Note.") for a in r.get("attachments") or [])
            try:
                sent = datetime.fromisoformat(str(r.get("sent_at")).replace("Z", "+00:00"))
            except ValueError:  # an unreadable date must not stall the whole batch: triage it now
                sent = datetime.min.replace(tzinfo=timezone.utc)
            if voice and r.get("transcript_status") is None and datetime.now(timezone.utc) - sent < timedelta(seconds=VOICE_WAIT_S):
                self._voice_wait[r["id"]] = now + VOICE_RECHECK_S
            else:
                self._voice_wait.pop(r["id"], None)
                keep.append(r)
        return keep

    def run_once(self) -> int:
        """Triages one batch. Returns how many were triaged, so the loop rests when nothing succeeded."""
        since = (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).isoformat()
        now = time.monotonic()
        rows = self.db.select("messages", pending_query(since, self._backoff.waiting(now) + [i for i, at in self._voice_wait.items() if at > now]))
        rows = self._without_untranscribed(rows)
        if not rows:
            return self.backfill_choices(since)
        for r in rows:  # opened first: known_outcome and superseded_outcome copy the subject into the summary
            self.vault.open_row(r["user_id"], r, [("subject", SUBJECT), ("list_unsubscribe", UNSUBSCRIBE), ("sender_address", ADDRESS)])
        thread_ids = sorted({r["thread_id"] for r in rows})
        found = self._all(
            {
                "contexts": lambda: self._contexts(sorted({r["user_id"] for r in rows})),
                "feedback": lambda: self.db.select(
                    "feedback", {"select": "thread_id,value", "thread_id": in_list(thread_ids), "order": "created_at.desc", "limit": "1000"}
                ),
                "latest": lambda: self._latest(rows),
            }
        )
        contexts: dict[str, UserContext] = found["contexts"]
        feedback: dict[str, list[str]] = {}
        for f in found["feedback"]:
            feedback.setdefault(f["thread_id"], []).append(f["value"])
        latest: dict[str, tuple[bool, bool]] = found["latest"]

        # Decide what needs the model: (result, model) for the rest.
        results: dict[str, tuple[dict[str, Any], str | None]] = {}
        sources: dict[str, str] = {}  # what decided each label: model, rule (your signals), copied or superseded
        ask: list[dict[str, Any]] = []
        for m in rows:
            ctx = contexts[m["user_id"]]
            settled = known_outcome(m, ctx, feedback.get(m["thread_id"], []))
            if settled is not None:
                results[m["id"]] = (settled, None)
                sources[m["id"]] = "rule"
            elif not latest[m["id"]][0]:
                results[m["id"]] = (superseded_outcome(m), None)
                sources[m["id"]] = "superseded"
            else:
                ask.append(m)
        settled_senders = self._settled_senders(ask)
        for m in list(ask):
            if m["id"] in settled_senders:
                results[m["id"]] = (settled_senders[m["id"]], None)
                sources[m["id"]] = "sender"
                ask.remove(m)
        twins = self._twins(ask, contexts)
        firsts: dict[tuple[str, str], dict[str, Any]] = {}  # the same email twice in this batch is asked about once
        copies: list[dict[str, Any]] = []
        for m in list(ask):
            key = (m["user_id"], m.get("provider_message_id") or m["id"])
            if key in twins:
                results[m["id"]] = twins[key]
                sources[m["id"]] = "copied"
                ask.remove(m)
            elif key in firsts:
                copies.append(m)
                sources[m["id"]] = "copied"
                ask.remove(m)
            else:
                firsts[key] = m

        asked = len(ask)
        if ask:
            for answers in self._pool.map(lambda chunk: self._ask(contexts[chunk[0]["user_id"]], chunk), self._prepare(ask, contexts)):
                results.update(answers)
        for m in copies:
            first = firsts[(m["user_id"], m.get("provider_message_id") or m["id"])]
            if first["id"] in results:
                results[m["id"]] = results[first["id"]]
        for m in ask:
            sources.setdefault(m["id"], "model")

        done = [m for m in rows if m["id"] in results]
        if not done:
            log.info("triage batch", messages=len(rows), triaged=0)
            return 0
        try:  # the answers are paid for: whatever fails from here on is backed off, or the next poll asks and pays again
            stored = {
                m["id"]: message_traits(
                    m,
                    sources[m["id"]],
                    chars=len((m.get("_email") or {}).get("body") or "") if m.get("_email") else None,
                    known=bool((m.get("_email") or {}).get("known")),
                    timezone=contexts[m["user_id"]].timezone,
                )
                for m in done
            }
            final = {m["id"]: apply_signals(results[m["id"]][0], (m.get("sender_address") or "").lower(), contexts[m["user_id"]], feedback.get(m["thread_id"], [])) for m in done}
            self.db.upsert(
                "message_ai",
                [
                    {
                        "message_id": m["id"],
                        "user_id": m["user_id"],
                        "priority": final[m["id"]]["priority"],
                        "category": final[m["id"]]["category"],
                        "summary": self.vault.seal(m["user_id"], SUMMARY, final[m["id"]]["summary"]),
                        "needs_reply": bool(final[m["id"]]["needs_reply"]),
                        "junk": bool(final[m["id"]]["junk"]),
                        "reply_choices": self.vault.seal(m["user_id"], CHOICES, final[m["id"]]["choices"]),
                        "model": results[m["id"]][1],
                        "prompt_version": prompt_id(SYSTEM) if results[m["id"]][1] else None,
                        "traits": stored[m["id"]],
                    }
                    for m in done
                ],
                on_conflict="message_id",
            )
        except Exception as err:
            paid = [m for m in done if sources[m["id"]] in ("model", "copied")] or done
            log.warn("triage answers not saved", messages=len(paid), code=log.code_of(err))
            self._failed(paid, None)
            return 0
        # The conversation takes the triage of its latest incoming message.
        updates = [m for m in done if latest[m["id"]][0]]
        list(self._pool.map(lambda m: self._update_thread_safely(m, final[m["id"]], latest[m["id"]][1]), updates))
        self._report(updates, final, stored)
        for m in done:
            self._backoff.succeeded(m["id"])
        log.info("triage batch", messages=len(rows), triaged=len(done), asked=asked, threads=len(updates))
        return len(done)

    def backfill_choices(self, since: str) -> int:
        """Choices for messages triaged before guided drafting, a GROUP at a time and only when there is
        nothing new to triage: recent ones that still need a reply. Only the latest incoming message of
        a conversation is asked about; the rest are marked as looked at. Returns how many were done."""
        rows = self.db.select(
            "message_ai",
            {
                "select": "message_id,messages!inner(id,user_id,account_id,thread_id,provider_message_id,subject,sender_address,"
                "sender_contact_id,list_unsubscribe,sent_at)",
                "needs_reply": "eq.true",
                "junk": "eq.false",
                "reply_choices": "is.null",
                "messages.sent_at": f"gte.{since}",
                **not_in(self._backoff.waiting(time.monotonic()), "message_id"),
                "limit": str(GROUP),
            },
        )
        batch = [r["messages"] for r in rows if isinstance(r.get("messages"), dict)]
        if not batch:
            return 0
        for m in batch:
            self.vault.open_row(m["user_id"], m, [("subject", SUBJECT), ("list_unsubscribe", UNSUBSCRIBE), ("sender_address", ADDRESS)])
        latest = self._latest(batch)
        ask = [m for m in batch if latest[m["id"]][0]]
        found: dict[str, str] = {m["id"]: NO_CHOICES for m in batch if not latest[m["id"]][0]}
        if ask:
            contexts = self._contexts(sorted({m["user_id"] for m in ask}))
            for answers in self._pool.map(lambda chunk: self._ask(contexts[chunk[0]["user_id"]], chunk), self._prepare(ask, contexts)):
                found.update({mid: result["choices"] for mid, (result, _model) in answers.items()})
        by_id = {m["id"]: m for m in batch}

        def store(item: tuple[str, str]) -> None:
            mid, choices = item
            self.db.update("message_ai", {"message_id": f"eq.{mid}"}, {"reply_choices": self.vault.seal(by_id[mid]["user_id"], CHOICES, choices)}, minimal=True)
            self._backoff.succeeded(mid)

        list(self._pool.map(store, found.items()))
        log.info("choices backfill", messages=len(batch), asked=len(ask), done=len(found))
        return len(found)

    def _all(self, calls: dict[str, Callable[[], Any]]) -> dict[str, Any]:
        futures = {name: self._pool.submit(fn) for name, fn in calls.items()}
        return {name: f.result() for name, f in futures.items()}

    # What is known --------------------------------------------------------------------------------

    def _prepare(self, ask: list[dict[str, Any]], contexts: dict[str, UserContext]) -> list[list[dict[str, Any]]]:
        """Bodies, senders' contacts and who you have written to, for the messages the model is asked about,
        then the groups to send. Adds name, relationship, known and body to each message."""
        contact_ids = sorted({m["sender_contact_id"] for m in ask if m.get("sender_contact_id")})
        found = self._all(
            {
                "bodies": lambda: self.db.select("messages", {"select": "id,body_text,body_html", "id": in_list([m["id"] for m in ask])}),
                "contacts": lambda: self.db.select("contacts", {"select": "id,display_name,relationship", "id": in_list(contact_ids)}) if contact_ids else [],
                "known": lambda: self._known_senders(contact_ids),
                "earlier": lambda: self._earlier(ask),
            }
        )
        bodies = {b["id"]: b for b in found["bodies"]}
        earlier = found["earlier"]
        contacts = {c["id"]: c for c in found["contacts"]}
        for m in ask:
            contact = contacts.get(m.get("sender_contact_id") or "") or {}
            body = self.vault.open_row(m["user_id"], dict(bodies.get(m["id"]) or {}), [("body_text", BODY), ("body_html", HTML)])
            said = self.vault.open(m["user_id"], TRANSCRIPT, m.get("transcript"))
            if said:  # a voice note is read as what was said in it
                body = {"body_text": f"Voice note: {said}\n\n{body.get('body_text') or ''}".strip(), "body_html": None}
            m["_email"] = {
                "name": contact.get("display_name") or "",
                "sender": (m.get("sender_address") or "").lower(),
                "relationship": self.vault.open(m["user_id"], CONTACT_RELATIONSHIP, contact.get("relationship")) or "",
                "known": m.get("sender_contact_id") in found["known"],
                "bulk": bool(m.get("list_unsubscribe")),
                "subject": (m.get("subject") or "")[:SUBJECT_CHARS],
                "sent": m.get("sent_at"),
                "body": clean(body.get("body_text"), body.get("body_html"), limit=BULK_BODY_CHARS if m.get("list_unsubscribe") or m.get("is_bulk") else BODY_CHARS),
                "earlier": [
                    {"from_me": r["direction"] == "outbound", "text": r["text"]}
                    for r in earlier_messages(earlier, m)
                    if r["text"]
                ],
            }
        return groups(ask)

    def _ask(self, ctx: UserContext, chunk: list[dict[str, Any]]) -> dict[str, tuple[dict[str, Any], str | None]]:
        """The model's results by message id for one group (one user and account). An email it would
        not answer in a group is asked about on its own, so it cannot hold the others up."""
        first = chunk[0]
        threads = {m["thread_id"] for m in chunk}
        usage = UsageContext(first["user_id"], "triage", first["account_id"], first["thread_id"] if len(threads) == 1 else None)
        try:
            result = self.gemini.json(
                self.model,
                SYSTEM,
                triage_prompt(ctx, [m["_email"] for m in chunk]),
                SCHEMA,
                usage,
                thinking="minimal",
                max_output=2048 + 256 * len(chunk),  # each answer is about 60 tokens; this only stops a runaway
            )
        except GeminiError as err:
            # Only an answer that was not usable (not JSON, blocked or empty, or the request refused) is worth asking
            # again one by one. A paused budget or a timeout would fail every single call too (a timeout was already billed).
            if len(chunk) > 1 and not is_billing_paused(err) and (err.status == 400 or "was not JSON" in str(err) or "no candidates" in str(err)):
                return {k: v for m in chunk for k, v in self._ask(ctx, [m]).items()}
            if billing_paused(err) or "budget_" in str(err):  # not the row's fault: it stays queued, and backing it off would hold it for hours
                log.info("triage paused", messages=len(chunk), reason="billing" if billing_paused(err) else "budget")
                return {}
            self._failed(chunk, err.status)
            return {}
        got = read_results(result, len(chunk))
        out = {m["id"]: (got[i], self.model) for i, m in enumerate(chunk, 1) if i in got}
        missing = [m for m in chunk if m["id"] not in out]
        if missing and len(chunk) > 1:
            if len(missing) < len(chunk):  # the others answered: the rest are asked together, one call and one system prompt
                out.update(self._ask(ctx, missing))
            else:  # none answered: the group itself is the problem, so one at a time
                for m in missing:
                    out.update(self._ask(ctx, [m]))
        elif missing:
            self._failed(missing, None)
        return out

    def _report(self, updates: list[dict[str, Any]], final: dict[str, dict[str, Any]], stored: dict[str, dict[str, Any]]) -> None:
        """One content-free event per label shown: what the AI said and the traits of the message. Set against
        the corrections people make, this gives the correction rate for each kind of message."""
        by_user: dict[str, list[dict[str, Any]]] = {}
        for m in updates:
            t = stored[m["id"]]
            if t["source"] == "superseded":
                continue
            r = final[m["id"]]
            by_user.setdefault(m["user_id"], []).append(
                event(
                    "triaged",
                    **t,
                    priority=r["priority"],
                    category=r["category"],
                    junk=bool(r["junk"]),
                    needs_reply=bool(r["needs_reply"]),
                    prompt=prompt_id(SYSTEM),
                )
            )
        for user_id, events in by_user.items():
            self.analytics.emit(user_id, events)

    def _failed(self, chunk: list[dict[str, Any]], status: int | None) -> None:
        now = time.monotonic()
        for m in chunk:
            failures = self._backoff.failed(m["id"], now)
            log.warn("triage failed", message=m["id"], status=status, failures=failures)

    def _update_thread_safely(self, m: dict[str, Any], result: dict[str, Any], waiting_on_them: bool) -> None:
        """One conversation that cannot be updated is logged and the rest still are."""
        try:
            self._update_thread(m, result, waiting_on_them)
        except Exception as err:
            log.warn("thread triage not saved", thread=m["thread_id"], code=log.code_of(err))

    def _update_thread(self, m: dict[str, Any], result: dict[str, Any], waiting_on_them: bool) -> None:
        self.db.update(
            "threads",
            {"id": f"eq.{m['thread_id']}"},
            {
                "priority": result["priority"],
                "category": result["category"],
                "summary": self.vault.seal(m["user_id"], SUMMARY, result["summary"]),
                "needs_reply": bool(result["needs_reply"]) and waiting_on_them,
                "junk": bool(result["junk"]),
            },
            minimal=True,
        )