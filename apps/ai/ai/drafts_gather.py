"""What a draft needs before the model is asked: the limits on how often a person may ask, the conversation, the
company and personal voice, similar past replies and the new-message case. A mixin of Drafts (db, vault, gemini
and embeddings are set up there).

Each read is a round trip (about 0.25s from a laptop, measured), and a draft used to make a dozen one after another.
Now the reads that need nothing from draft_context (the person's key, their vectors, settings, calendar, the files
and templates a next step may offer, the budget) start with it (_early), and the ones that need
the conversation (similar replies, the company voice, rules, the note on this person) start together once it is in.

Other conversations (similar replies, more of your sent mail) are left out when the latest message is flagged suspicious
or comes from someone you have never written to, and the other side's newest text is kept apart from the evidence the
fact guard trusts (drafts_facts.check), so a stranger's email cannot vouch for an account number it asks a reply to repeat."""

from __future__ import annotations

from concurrent.futures import Future, wait
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from . import actions, log
from .company_voice import pick_company
from .drafts_context import (
    COMPOSE_PER_HOUR,
    OLDER_CHARS,
    RECENT_VOICE,
    SIMILAR_LIMIT,
    describe,
    others_voice_ok,
    pick_facts,
    pick_more_voice,
    pick_similar,
    pick_voice,
    stale,
)
from .drafts_facts import CALENDAR_DAYS, calendar_lines
from .drafts_prompt import build_prompt, is_adjust
from .rules import safe_rule
from .fields import (
    BODY,
    CHOICES,
    CONTACT_ABOUT,
    CONTACT_RELATIONSHIP,
    CONTACT_STYLE_NOTE,
    CONTACT_SUMMARY,
    PROFILE_ABOUT,
    HTML,
    NAME,
    NOTE,
    NOTE_TITLE,
    ORG_SUMMARY,
    QUOTE,
    STYLE_RULE,
    SUBJECT,
    TRANSCRIPT,
    WRITING_BODY,
    WRITING_SITUATION,
)
from .gemini import DEFAULT_LIMITS
from .flags import PAUSE_PREDRAFTS, flags_for
from .predraft_cap import user_cap_reached


def evidence_of(you: dict[str, Any], conversation: list[str], d: dict[str, Any], subject: str | None, calendar: list[str]) -> list[str]:
    """Everything a draft may rightly state, as plain texts for the fact check: the conversation up to your last
    message, what you asked for, the saved facts and your note about this person, and the calendar. The other side's
    newest text, the decision worded from it and the name they gave themselves are untrusted_of, not this."""
    out = list(conversation) + [subject or "", d.get("instruction") or "", you.get("about_note") or "", you.get("me") or ""]
    for title, body in you.get("facts") or []:
        out += [title, body]
    return [t for t in out + calendar if t]


def answered_upto(messages: list[dict[str, Any]]) -> int:
    """How many of messages (oldest first) come before the other side's unanswered run: up to and with your last one."""
    return next((i + 1 for i in range(len(messages) - 1, -1, -1) if messages[i].get("direction") == "outbound"), 0)


def untrusted_of(conversation: list[str], upto: int, d: dict[str, Any], subject: str | None, them: str = "") -> list[str]:
    """The other side's text the draft answers: their messages after your last one, the one-tap decision triage worded
    from them, their display name, and the subject while you have not written in the conversation. It backs a day or a
    time in the draft, never an amount, account, phone number or address (drafts_facts.check)."""
    out = list(conversation[upto:]) + [d.get("decision") or "", them] + ([subject or ""] if not upto else [])
    return [t for t in out if t]


def audit_of(you: dict[str, Any], messages: int, calendar: bool) -> dict[str, Any]:
    """What a draft was written from, as counts only (the app shows "Based on: last 3 messages, 2 saved facts")."""
    return {
        "messages": messages,
        "facts": len(you.get("facts") or []),
        "rules": len(you.get("rules") or []) + len(you.get("person_rules") or []),
        "replies": len(you.get("similar") or []) + len(you.get("more_voice") or []) + len(you.get("recent") or []),
        "note": bool(you.get("about_note")),
        "calendar": calendar,
    }


def asks_edit(d: dict[str, Any]) -> bool:
    """Whether the draft revises text (an edit, or an adjustment of the reply box): the same test _gather makes."""
    return d.get("tone") == "edit" or (is_adjust(d.get("tone")) and d.get("source") is not None)


def ran(fn: Callable[..., Any], *args: Any) -> Future:
    """fn(*args) run here, as a finished Future, for a host with no read pool (tests)."""
    f: Future = Future()
    try:
        f.set_result(fn(*args))
    except Exception as err:
        f.set_exception(err)
    return f


def settle(f: Future | None) -> None:
    """Waits for a started read without taking its result or its error: whoever uses it reads or reports it again."""
    if f is not None:
        wait([f])


def got(f: Future | None, default: Any = None) -> Any:
    """A started read's result, or default when it was not started."""
    return default if f is None else f.result()


class GatherMixin:
    def _start(self, fn: Callable[..., Any], *args: Any) -> Future:
        """fn(*args) on the read pool, so reads that do not need each other run at the same time."""
        pool = getattr(self, "_reads", None)
        return pool.submit(fn, *args) if pool is not None else ran(fn, *args)

    def _early(self, d: dict[str, Any]) -> dict[str, Future]:
        """The reads a draft needs that do not wait on draft_context, started now. None of them fails the draft: each
        catches its own errors, and the key and the vectors are only waited for, so their use reads them again on an error."""
        user, thread = d["user_id"], d.get("thread_id")
        edit = asks_edit(d)
        out: dict[str, Future] = {"composer": self._start(self._composer, user)}
        keys_for = getattr(self.vault, "keys_for", None)
        if keys_for is not None:  # a key read after its 10 minute cache is a KMS round trip too
            out["keys"] = self._start(keys_for, user)
        preload = getattr(self.gemini, "preload", None)
        if preload is not None:
            out["budget"] = self._start(preload, user, "draft")
        if thread:
            vectors = getattr(getattr(self.embeddings, "index", None), "items", None)
            if vectors is not None:  # a cold read of the vectors is the slowest part of a draft: started first
                out["index"] = self._start(vectors, user)
            if not edit:
                out["calendar"] = self._start(self._calendar, user)
                out["suspicious"] = self._start(self._suspicious, user, thread)
                out["offer"] = self._start(actions.gather, self.db, self.vault, user, thread)
        return out

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
        if auto and d.get("user_id") and flags_for(self.db).is_on(PAUSE_PREDRAFTS, d["user_id"]):  # the owner's kill switch (Admin, Flags)
            self._expire(d)
            log.info("pre-drafts paused", draft=d["id"])
            return True
        if auto and d.get("user_id") and user_cap_reached(self.db, d["user_id"]):  # the per-user daily cap, whatever put the row there
            self._expire(d)
            log.info("pre-draft cap reached", draft=d["id"])
            return True
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

    def _gather(self, d: dict[str, Any], early: dict[str, Future] | None = None) -> dict[str, Any] | str | None:
        """Everything the prompt needs, the reason the draft cannot be written, or None for a pre-draft
        that is no longer wanted. Reads only: one call to public.draft_context, plus an embedding and a
        search when the email has no vector yet. early is what _early started (started here when not given)."""
        user = d["user_id"]
        early = self._early(d) if early is None else early
        first = self.db.rpc("draft_context", {"p_user": user, "p_thread": d["thread_id"]}) or {}
        settle(early.get("keys"))  # read alongside draft_context, so opening it does not read them again
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
        channel = thread.get("channel") or "email"
        # The team's voice is for a new draft in a work chat. An edit or adjustment only corrects their own text.
        company = self._start(self._company, user, d["thread_id"]) if edit is None else None
        rules = self._start(self._channel_rules, user, channel, first["rules"])
        about = self._start(self._about_note, user, contact)
        latest_in = next((m for m in reversed(messages) if m["direction"] == "inbound"), None)
        voice_ok = others_voice_ok(messages, first.get("to_them") or [], bool(got(early.get("suspicious"), False)))
        similar = self._similar(user, thread, latest_in) if voice_ok else []
        names = {cid: self.vault.open(user, NAME, name) for cid, name in (first.get("senders") or {}).items()}
        if contact:
            names.setdefault(contact.get("id"), self.vault.open(user, NAME, contact.get("display_name")))

        conversation = []
        for i, m in enumerate(messages):
            who = "Them" if m["direction"] == "inbound" else "Me"
            if m["direction"] == "inbound" and m.get("sender_contact_id") in names:
                who = names[m["sender_contact_id"]] or "Them"
            conversation.append((who, describe(m, 1500 if i >= len(messages) - 2 else OLDER_CHARS)))

        company = got(company)
        you = self._you(user, first, similar, channel, composer=got(early.get("composer")), rules=got(rules), about=got(about))
        if not voice_ok:
            you["more_voice"] = []
        calendar = got(early.get("calendar"), []) if edit is None else []
        texts, upto = [text for _, text in conversation], answered_upto(messages)
        return {
            "thread": thread,
            "evidence": evidence_of(you, texts[:upto], d, thread.get("subject") if upto else None, calendar),
            "untrusted": untrusted_of(texts, upto, d, thread.get("subject"), you.get("them") or ""),
            "audit": audit_of(you, len(conversation), bool(calendar)),
            "prompt": build_prompt(
                **you,
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
                voice_note=bool(latest_in and latest_in.get("transcript") and messages[-1] is latest_in),
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

    def _composer(self, user: str) -> dict[str, Any]:
        """The tone chosen in Settings and whether any send address has a signature, for the prompt. Two small reads of
        plain columns (the signature text itself is sealed and never opened here). Never fails the draft."""
        try:
            tone = self.db.select("profiles", {"select": "draft_tone", "user_id": f"eq.{user}", "limit": "1"})
            signed = self.db.select("account_composer", {"select": "account_id", "user_id": f"eq.{user}", "has_signature": "eq.true", "limit": "1"})
            return {"draft_tone": (tone[0].get("draft_tone") if tone else None), "has_signature": bool(signed)}
        except Exception as err:
            log.warn("draft settings not read", code=log.code_of(err))
            return {}

    def _about_note(self, user: str, contact: dict[str, Any]) -> str:
        """What the user wrote about this person (contacts.about_note, sealed). The draft_context and
        compose_context functions do not return it, so it is read here. Never fails the draft: without it
        the prompt is written as before."""
        if contact.get("about_note") is not None:
            return self.vault.open(user, CONTACT_ABOUT, contact.get("about_note")) or ""
        if not contact.get("id"):
            return ""
        try:
            row = self.db.first("contacts", {"select": "about_note", "id": f"eq.{contact['id']}", "user_id": f"eq.{user}"}) or {}
            return self.vault.open(user, CONTACT_ABOUT, row.get("about_note")) or ""
        except Exception as err:
            log.warn("about note not read", code=log.code_of(err))
            return ""

    def _suspicious(self, user: str, thread: str) -> bool:
        """Whether triage flagged the conversation's latest incoming message (threads.suspicious). Never fails the draft:
        unread, it counts as not flagged and only the unknown-sender test applies."""
        try:
            row = self.db.first("threads", {"select": "suspicious", "id": f"eq.{thread}", "user_id": f"eq.{user}"}) or {}
            return bool(row.get("suspicious")) if isinstance(row, dict) else False
        except Exception as err:
            log.warn("suspicious flag not read", code=log.code_of(err))
            return False

    def _calendar(self, user: str) -> list[str]:
        """The next CALENDAR_DAYS of events as plain day and time lines, for the fact check only (titles are never
        read). Never fails the draft: without them a weekday is found only when the conversation names it."""
        try:
            now = datetime.now(timezone.utc)
            rows = self.db.select(
                "calendar_events",
                {"select": "starts_at,ends_at,all_day", "user_id": f"eq.{user}", "and": f"(starts_at.gte.{(now - timedelta(days=1)).isoformat()},starts_at.lte.{(now + timedelta(days=CALENDAR_DAYS)).isoformat()})", "order": "starts_at", "limit": "100"},
            )
            zone = self.db.first("profiles", {"select": "timezone", "user_id": f"eq.{user}"}) or {}
            return calendar_lines(rows, zone.get("timezone"), now)
        except Exception as err:
            log.warn("calendar not read for draft check", code=log.code_of(err))
            return []

    def _channel_rules(self, user: str, channel: str, rules: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """rules without the ones learned on the other channel, so email habits never reach a WhatsApp draft. draft_context
        returns rules without their channel, so the other channel's are read here (one small read) and left out by
        their stored text. Never fails the draft: on an error the rules are kept as they came."""
        other = "email" if channel == "whatsapp" else "whatsapp"
        try:
            left = self.db.select("style_rules", {"select": "rule", "user_id": f"eq.{user}", "enabled": "is.true", "channel": f"eq.{other}", "limit": "200"})
        except Exception as err:
            log.warn("channel rules not read", code=log.code_of(err))
            return rules
        gone = {r.get("rule") for r in left if isinstance(r, dict)} if isinstance(left, list) else set()
        return [r for r in rules if r.get("rule") not in gone] if gone else rules

    def _you(
        self,
        user: str,
        first: dict[str, Any],
        similar: list[tuple[str, str]],
        channel: str = "email",
        *,
        composer: dict[str, Any] | None = None,
        rules: list[dict[str, Any]] | None = None,
        about: str | None = None,
    ) -> dict[str, Any]:
        """The parts of the prompt about you and the person, from draft_context or compose_context. composer, rules
        (already without the other channel's) and about (the note on this person) are read here unless given."""
        profile = first.get("profile") or {}
        contact = first.get("contact") or {}
        contact_id = contact.get("id")
        org = contact.get("organizations") or {}
        recent = pick_voice([], first["recent"], limit=RECENT_VOICE)
        opened = lambda field, value: self.vault.open(user, field, value) or ""  # sealed or plain
        kept = self._channel_rules(user, channel, first["rules"]) if rules is None else rules
        # safe_rule again on the way in: a rule stored before a word joined the filter (rules.py) still never reaches a draft.
        rules = [r for r in ({**r, "rule": opened(STYLE_RULE, r.get("rule"))} for r in kept) if not r["rule"] or safe_rule(r["rule"])]
        return {
            **(self._composer(user) if composer is None else composer),
            "me": profile.get("display_name") or "",
            "about": opened(PROFILE_ABOUT, profile.get("about")),
            "rules": [r["rule"] for r in rules if r["scope"] == "global" and r["rule"]][:20],
            "examples": [(opened(WRITING_SITUATION, e.get("situation")), opened(WRITING_BODY, e.get("body"))) for e in first["examples"]],
            "recent": recent,
            "facts": pick_facts([(self.vault.open(user, NOTE_TITLE, f.get("title")) or "", self.vault.open(user, NOTE, f.get("body")) or "") for f in first.get("facts") or []]),
            "them": self.vault.open(user, NAME, contact.get("display_name")) or "",
            "relationship": opened(CONTACT_RELATIONSHIP, contact.get("relationship")),
            "style_note": opened(CONTACT_STYLE_NOTE, contact.get("style_note")),
            "about_note": self._about_note(user, contact) if about is None else about,
            "who_they_are": opened(CONTACT_SUMMARY, contact.get("ai_summary")) or (f"{opened(NAME, org.get('name'))}: {opened(ORG_SUMMARY, org['summary'])}" if org.get("summary") else ""),
            "person_rules": [r["rule"] for r in rules if contact_id and r["scope"] == "contact" and r.get("contact_id") == contact_id and r["rule"]][:10],
            "more_voice": pick_more_voice(first.get("to_them") or [], first["recent"], shown=recent, similar=similar),
            "similar": similar,
        }

    def _gather_compose(self, d: dict[str, Any], early: dict[str, Future] | None = None) -> dict[str, Any] | str:
        """A new message's prompt, from public.compose_context: no conversation, so no similar replies."""
        user = d["user_id"]
        early = self._early(d) if early is None else early
        first = self.db.rpc("compose_context", {"p_user": user, "p_account": d.get("account_id"), "p_contact": d.get("contact_id")}) or {}
        settle(early.get("keys"))
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
        contact = first.get("contact") or {}
        rules, about = self._start(self._channel_rules, user, channel, first["rules"]), self._start(self._about_note, user, contact)
        you = self._you(user, first, [], channel, composer=got(early.get("composer")), rules=got(rules), about=got(about))
        return {
            "thread": {"id": None, "account_id": account["id"]},
            "evidence": evidence_of(you, [], d, None, []),
            "untrusted": untrusted_of([], 0, d, None, you.get("them") or ""),
            "audit": audit_of(you, 0, False),
            "prompt": build_prompt(
                **you,
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
