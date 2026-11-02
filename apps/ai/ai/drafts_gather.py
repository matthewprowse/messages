"""What a draft needs before the model is asked: the limits on how often a person may ask, the conversation, the
company and personal voice, similar past replies and the new-message case. A mixin of Drafts (db, vault, gemini
and embeddings are set up there)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from . import log
from .company_voice import pick_company
from .drafts_context import (
    COMPOSE_PER_HOUR,
    OLDER_CHARS,
    RECENT_VOICE,
    SIMILAR_LIMIT,
    describe,
    pick_facts,
    pick_more_voice,
    pick_similar,
    pick_voice,
    stale,
)
from .drafts_prompt import build_prompt, is_adjust
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


class GatherMixin:
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
            **self._composer(user),
            "me": profile.get("display_name") or "",
            "about": opened(PROFILE_ABOUT, profile.get("about")),
            "rules": [r["rule"] for r in rules if r["scope"] == "global" and r["rule"]][:20],
            "examples": [(opened(WRITING_SITUATION, e.get("situation")), opened(WRITING_BODY, e.get("body"))) for e in first["examples"]],
            "recent": recent,
            "facts": pick_facts([(self.vault.open(user, NOTE_TITLE, f.get("title")) or "", self.vault.open(user, NOTE, f.get("body")) or "") for f in first.get("facts") or []]),
            "them": self.vault.open(user, NAME, contact.get("display_name")) or "",
            "relationship": opened(CONTACT_RELATIONSHIP, contact.get("relationship")),
            "style_note": opened(CONTACT_STYLE_NOTE, contact.get("style_note")),
            "about_note": self._about_note(user, contact),
            "who_they_are": opened(CONTACT_SUMMARY, contact.get("ai_summary")) or (f"{opened(NAME, org.get('name'))}: {opened(ORG_SUMMARY, org['summary'])}" if org.get("summary") else ""),
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
