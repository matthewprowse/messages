"""What triage knows about the people and conversations it judges: each user's context (rules, unsubscribes,
corrections), the latest incoming message per thread, settled bulk senders, copies of the same email in another
account, earlier messages and known senders. A mixin of Triage (db, vault and pool are set up there)."""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

from . import log
from .fields import ADDRESS, BODY, CHOICES, HTML, SUBJECT, SUMMARY, TRANSCRIPT
from .supabase import in_list
from .text import clean
from .triage_signals import CONTEXT_CHARS, CONTEXT_MESSAGES, CONTEXT_TTL_S, LATEST_ROWS, SENDER_KEEP, UserContext, latest_incoming, sender_outcome


class ContextMixin:
    def _contexts(self, user_ids: list[str]) -> dict[str, UserContext]:
        """Each user's context, reread when older than CONTEXT_TTL_S. Runs in the pool: reads in sequence."""
        now = time.monotonic()
        out = {}
        for uid in user_ids:
            cached = self._users.get(uid)
            if cached is None or now - cached[0] > CONTEXT_TTL_S:
                cached = (now, self._user_context(uid))
                self._users[uid] = cached
            out[uid] = cached[1]
        return out

    def _user_context(self, user_id: str) -> UserContext:
        profile = self.db.first("profiles", {"select": "display_name,about,important_people,timezone,language", "user_id": f"eq.{user_id}"}) or {}
        rules = self.db.select("priority_rules", {"select": "kind,target", "user_id": f"eq.{user_id}"})
        unsubs = self.db.select("unsubscribes", {"select": "sender_address", "user_id": f"eq.{user_id}"})
        accounts = self.db.select("accounts", {"select": "id,address", "user_id": f"eq.{user_id}"})
        feedback = self.db.select(
            "feedback",
            {"select": "value,threads(subject)", "user_id": f"eq.{user_id}", "order": "created_at.desc", "limit": "20"},
        )
        corrections = [
            f'"{self.vault.open(user_id, SUBJECT, (f.get("threads") or {}).get("subject")) or "(no subject)"}" marked {f["value"].replace("_", " ")}'
            for f in feedback
        ]
        return UserContext(
            name=profile.get("display_name") or "",
            own_addresses=sorted({a for a in ((self.vault.open(user_id, ADDRESS, r.get("address")) or "").lower() for r in accounts) if "@" in a}),
            about=profile.get("about") or "",
            important_people=profile.get("important_people") or "",
            always=[self.vault.open(user_id, ADDRESS, r["target"]) or "" for r in rules if r["kind"] == "always_important"],
            never=[self.vault.open(user_id, ADDRESS, r["target"]) or "" for r in rules if r["kind"] == "never_important"],
            unsubscribed={(self.vault.open(user_id, ADDRESS, u["sender_address"]) or "").lower() for u in unsubs},
            corrections=corrections,
            accounts=[a["id"] for a in accounts],
            timezone=profile.get("timezone") or "",
            language=profile.get("language") or "",
        )

    def _latest(self, batch: list[dict[str, Any]]) -> dict[str, tuple[bool, bool]]:
        """For each message: (latest incoming in its conversation, conversation waiting on them). One read
        for the batch, and two per conversation only for messages that read could not settle."""
        since = min(m["sent_at"] for m in batch)
        rows = self.db.select(
            "messages",
            {
                "select": "id,thread_id,direction",
                "thread_id": in_list(sorted({m["thread_id"] for m in batch})),
                "sent_at": f"gte.{since}",
                "order": "sent_at.desc,id.desc",
                "limit": str(LATEST_ROWS),
            },
        )
        out: dict[str, tuple[bool, bool]] = {}
        decided_all = latest_incoming(rows, batch)
        for m in batch:
            decided = decided_all[m["id"]]
            if decided is None:
                latest_in = self.db.first(
                    "messages", {"select": "id", "thread_id": f"eq.{m['thread_id']}", "direction": "eq.inbound", "order": "sent_at.desc,id.desc"}
                )
                latest_any = self.db.first("messages", {"select": "direction", "thread_id": f"eq.{m['thread_id']}", "order": "sent_at.desc,id.desc"})
                decided = (bool(latest_in) and latest_in["id"] == m["id"], bool(latest_any) and latest_any["direction"] == "inbound")
            out[m["id"]] = decided
        return out

    def _settled_senders(self, messages: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        """Results by message id for bulk mail from a sender the model has settled on (sender_outcome). One
        read per user for the batch. Without the sender_history migration, or when it fails, nothing is
        settled and the model is asked as before."""
        wanted: dict[str, set[str]] = {}
        for m in messages:
            if (m.get("is_bulk") or m.get("list_unsubscribe")) and m.get("sender_index"):
                wanted.setdefault(m["user_id"], set()).add(m["sender_index"])
        history: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for user_id, senders in wanted.items():
            try:
                rows = self.db.rpc("sender_history", {"p_user": user_id, "p_senders": sorted(senders), "p_keep": SENDER_KEEP}) or []
            except Exception as err:
                log.warn("sender history not read", code=log.code_of(err))
                continue
            for r in rows:
                history.setdefault((user_id, r["sender_index"]), []).append(r)
        now = datetime.now(timezone.utc)
        out = {}
        for m in messages:
            outcome = sender_outcome(m, history.get((m["user_id"], m.get("sender_index") or ""), []), now)
            if outcome is not None:
                out[m["id"]] = outcome
        return out

    def _twins(self, messages: list[dict[str, Any]], contexts: dict[str, UserContext]) -> dict[tuple[str, str], tuple[dict[str, Any], str | None]]:
        """Triage already done for the same email (Message-ID) in another of the user's accounts."""
        users = sorted({m["user_id"] for m in messages if len(contexts[m["user_id"]].accounts) > 1 and m.get("provider_message_id")})
        if not users:
            return {}
        ids = sorted({m["provider_message_id"] for m in messages if m["user_id"] in users and m.get("provider_message_id")})
        accounts = sorted({a for u in users for a in contexts[u].accounts})
        rows = self.db.select(
            "messages",
            {
                "select": "user_id,provider_message_id,message_ai!inner(priority,category,summary,needs_reply,junk,reply_choices,model)",
                "account_id": in_list(accounts),  # with the Message-ID, this is the (account_id, provider_message_id) index
                "provider_message_id": in_list(ids),
                "direction": "eq.inbound",
                "limit": "200",
            },
        )
        out = {}
        for r in rows:
            ai = r.get("message_ai")
            ai = ai[0] if isinstance(ai, list) and ai else ai
            if r["user_id"] in users and isinstance(ai, dict):
                copied = {k: ai[k] for k in ("priority", "category", "summary", "needs_reply", "junk")}
                copied["summary"] = self.vault.open(r["user_id"], SUMMARY, copied["summary"])  # sealed again when written
                copied["choices"] = self.vault.open(r["user_id"], CHOICES, ai.get("reply_choices"))
                out[(r["user_id"], r["provider_message_id"])] = (copied, ai.get("model"))
        return out

    # Asking the model -----------------------------------------------------------------------------

    def _earlier(self, ask: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Recent messages of the conversations being judged, newest first, each with its text opened and
        cut to CONTEXT_CHARS. Bulk mail gets none: a newsletter is judged on its own. One read for the group."""
        threads = sorted({m["thread_id"] for m in ask if not (m.get("list_unsubscribe") or m.get("is_bulk"))})
        if not threads:
            return []
        # One read per thread: a single capped read across all of them let a busy thread's history use up the cap
        # and leave the others with no context.
        newest: dict[str, str] = {}
        for m in ask:
            newest[m["thread_id"]] = max(newest.get(m["thread_id"], m["sent_at"]), m["sent_at"])
        rows: list[dict[str, Any]] = []
        for thread in threads:
            rows += self.db.select(
                "messages",
                {
                    "select": "id,user_id,thread_id,direction,sent_at,transcript,body_text,body_html",
                    "thread_id": in_list([thread]),
                    "sent_at": f"lte.{newest[thread]}",
                    "order": "sent_at.desc,id.desc",
                    "limit": str(CONTEXT_MESSAGES + 2),
                },
            )
        users = {m["thread_id"]: m["user_id"] for m in ask}
        for r in rows:
            user_id = users[r["thread_id"]]
            opened = self.vault.open_row(user_id, r, [("body_text", BODY), ("body_html", HTML)])
            said = self.vault.open(user_id, TRANSCRIPT, r.get("transcript"))
            text = f"Voice note: {said}" if said else clean((opened or r).get("body_text"), (opened or r).get("body_html"), limit=CONTEXT_CHARS)
            r["text"] = " ".join(text.split())[:CONTEXT_CHARS]
        return rows

    def _known_senders(self, contact_ids: list[str]) -> set[str]:
        """The contacts they have written to before, a strong sign the mail is personal: contacts in a
        conversation where they sent something."""
        if not contact_ids:
            return set()
        parts = self.db.select("thread_participants", {"select": "thread_id,contact_id", "contact_id": in_list(contact_ids), "limit": "2000"})
        threads = sorted({p["thread_id"] for p in parts})
        if not threads:
            return set()
        replied: set[str] = set()
        for i in range(0, len(threads), 100):
            sent = self.db.select("messages", {"select": "thread_id", "thread_id": in_list(threads[i : i + 100]), "direction": "eq.outbound", "limit": "1000"})
            replied.update(s["thread_id"] for s in sent)
        return {p["contact_id"] for p in parts if p["thread_id"] in replied}
