"""Learning from your edits. When you send a reply that started as a draft, the draft and what you
actually sent are stored side by side. If you changed it meaningfully, the model turns the
difference into short style rules, which drafts follow from then on. Rules seen again gain support.

A draft you threw away and then answered yourself counts too: what you wrote instead is compared
with the draft, as a full rewrite."""

from __future__ import annotations

import difflib
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from . import log
from .fields import BODY, DRAFT, HTML
from .gemini import Gemini, GeminiError, UsageContext
from .supabase import Supabase, in_list
from .text import clean
from .vault import Vault

LEARN_FROM_RATIO = 0.1  # below this the draft was sent more or less as written
REWRITE_DAYS = 14  # thrown away drafts this recent are checked for a reply you wrote yourself
REWRITE_GAP_DAYS = 3  # that reply must follow the draft within this long
REWRITES_EVERY_S = 600  # thrown away drafts are looked at this often; sent ones on every run

SCHEMA = {
    "type": "object",
    "properties": {
        "rules": {
            "type": "array",
            "maxItems": 3,
            "items": {
                "type": "object",
                "properties": {
                    "rule": {"type": "string", "description": "One short, concrete instruction, e.g. 'Signs off with Matt, never Best'."},
                    "scope": {"type": "string", "enum": ["global", "contact"]},
                },
                "required": ["rule", "scope"],
            },
        }
    },
    "required": ["rules"],
}

SYSTEM = """You compare an AI-written email draft with what the person actually sent, and write down what
the changes say about how they write. Rules must be short, concrete and reusable for future emails:
greetings, sign-offs, length, formality, phrases they use or avoid, punctuation habits.
Use scope "contact" only when the change is clearly about this particular person.
Skip one-off content changes (facts, dates, decisions). Return no rules if nothing general can be learned.
If an existing rule already says it, repeat that rule's wording exactly so it gains support."""


def edit_ratio(draft: str, sent: str) -> float:
    """0 means sent exactly as drafted, 1 means completely rewritten. Compared word by word."""
    a, b = re.findall(r"\S+", draft), re.findall(r"\S+", sent)
    if not a and not b:
        return 0.0
    return round(1 - difflib.SequenceMatcher(None, a, b, autojunk=False).ratio(), 3)


def _ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def rewrite_pairs(
    discarded: list[dict[str, Any]], outbound: list[dict[str, Any]], thread_drafts: list[dict[str, Any]]
) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    """(draft, message) for each thrown away draft you then answered yourself: your first email in that
    conversation after the draft, within REWRITE_GAP_DAYS, with no newer draft asked for in between
    (that newer draft is the one the reply relates to)."""
    pairs = []
    for d in discarded:
        start = _ts(d["created_at"])
        later = sorted(
            (m for m in outbound if m["thread_id"] == d["thread_id"] and start < _ts(m["sent_at"]) <= start + timedelta(days=REWRITE_GAP_DAYS)),
            key=lambda m: _ts(m["sent_at"]),
        )
        if not later:
            continue
        reply = later[0]
        newer = any(
            o["thread_id"] == d["thread_id"] and o["id"] != d["id"] and start < _ts(o["created_at"]) < _ts(reply["sent_at"]) for o in thread_drafts
        )
        if not newer:
            pairs.append((d, reply))
    return pairs


class Learn:
    def __init__(self, db: Supabase, gemini: Gemini, model: str, vault: Vault | None = None):
        self.db = db
        self.gemini = gemini
        self.model = model
        self.vault = vault or Vault(db)  # without one, plaintext passes through and nothing is encrypted
        self._rewrites_at = 0.0

    def run_once(self) -> int:
        # Ids first, bodies only for the replies not learned from yet: usually there are none.
        sent = self.db.select(
            "outbox", {"select": "id,draft_id", "status": "eq.sent", "draft_id": "not.is.null", "order": "sent_at.desc", "limit": "20"}
        )
        done = 0
        if sent:
            seen = {o["draft_id"] for o in self.db.select("draft_outcomes", {"select": "draft_id", "draft_id": in_list([s["draft_id"] for s in sent])})}
            new = [s["id"] for s in sent if s["draft_id"] not in seen]
            todo = (
                self.db.select("outbox", {"select": "id,user_id,thread_id,body,draft_id,drafts(body,status)", "id": in_list(new), "order": "sent_at.desc"})
                if new
                else []
            )
            todo = [s for s in todo if s.get("drafts")]
            for row in todo:
                if not row.get("thread_id"):  # a new email or chat whose conversation is not filed yet: next time
                    continue
                try:  # one row that fails must not hold up the ones behind it
                    self.vault.open_row(row["user_id"], row, [("body", BODY)])
                    self.vault.open_row(row["user_id"], row["drafts"], [("body", DRAFT)])
                    self._learn(row["user_id"], row["draft_id"], row["thread_id"], row["drafts"]["body"] or "", row["body"], mark_sent=True)
                    done += 1
                except Exception as err:
                    log.warn("draft outcome not learned", draft=row["draft_id"], code=log.code_of(err))
        if time.monotonic() - self._rewrites_at >= REWRITES_EVERY_S:
            self._rewrites_at = time.monotonic()
            try:
                done += self._rewrites()
            except Exception as err:
                log.error("rewrite learning failed", code=log.code_of(err))
        return done

    def _rewrites(self) -> int:
        """Thrown away drafts you answered yourself, compared with what you wrote instead."""
        since = (datetime.now(timezone.utc) - timedelta(days=REWRITE_DAYS)).isoformat()
        discarded = self.db.select(
            "drafts",
            {
                "select": "id,user_id,thread_id,body,created_at",
                "status": "eq.discarded",
                "tone": "neq.edit",
                "thread_id": "not.is.null",  # a new message thrown away has no conversation to compare with  # an edit you undid is your own text, not a draft you replaced
                "body": "neq.",
                "created_at": f"gte.{since}",
                "order": "created_at.desc",
                "limit": "50",
            },
        )
        # body=neq. only skips plaintext empty bodies: an encrypted empty body is not '', so check once opened.
        discarded = [d for d in discarded if self.vault.open_row(d["user_id"], d, [("body", DRAFT)])["body"]]
        if not discarded:
            return 0
        seen = {o["draft_id"] for o in self.db.select("draft_outcomes", {"select": "draft_id", "draft_id": in_list([d["id"] for d in discarded])})}
        discarded = [d for d in discarded if d["id"] not in seen]
        if not discarded:
            return 0
        thread_ids = sorted({d["thread_id"] for d in discarded})
        earliest = min(d["created_at"] for d in discarded)
        outbound = self.db.select(
            "messages",
            {
                "select": "id,user_id,thread_id,body_text,body_html,sent_at",
                "thread_id": in_list(thread_ids),
                "direction": "eq.outbound",
                "sent_at": f"gt.{earliest}",
                "order": "sent_at",
                "limit": "200",
            },
        )
        if not outbound:
            return 0
        for m in outbound:
            self.vault.open_row(m["user_id"], m, [("body_text", BODY), ("body_html", HTML)])
        thread_drafts = self.db.select(
            "drafts", {"select": "id,thread_id,created_at", "thread_id": in_list(thread_ids), "created_at": f"gte.{earliest}", "limit": "500"}
        )
        done = 0
        for d, reply in rewrite_pairs(discarded, outbound, thread_drafts):
            if reply["user_id"] != d["user_id"]:
                continue
            sent_body = clean(reply.get("body_text"), reply.get("body_html"), limit=4000)
            if sent_body:
                try:
                    self._learn(d["user_id"], d["id"], d["thread_id"], d["body"], sent_body, mark_sent=False)
                    done += 1
                except Exception as err:
                    log.warn("rewrite not learned", draft=d["id"], code=log.code_of(err))
        return done

    def _learn(self, user_id: str, draft_id: str, thread_id: str, draft_body: str, sent_body: str, *, mark_sent: bool) -> None:
        ratio = edit_ratio(draft_body, sent_body)
        row = {"user_id": user_id, "draft_id": draft_id, "thread_id": thread_id, "body": sent_body}
        thread = self.db.first("threads", {"select": "account_id,user_id", "id": f"eq.{thread_id}"})
        if not thread or thread["user_id"] != user_id:
            return
        latest_in = self.db.first(
            "messages",
            {"select": "sender_contact_id", "thread_id": f"eq.{thread_id}", "direction": "eq.inbound", "order": "sent_at.desc"},
        )
        contact_id = (latest_in or {}).get("sender_contact_id")

        self.db.insert(
            "draft_outcomes",
            {
                "user_id": user_id,
                "draft_id": draft_id,
                "thread_id": thread_id,
                "contact_id": contact_id,
                "draft_body": self.vault.seal(user_id, DRAFT, draft_body),
                "sent_body": self.vault.seal(user_id, BODY, sent_body),
                "edit_ratio": ratio,
            },
        )
        if mark_sent:
            self.db.update("drafts", {"id": f"eq.{draft_id}"}, {"status": "sent"})
        log.info("draft outcome", draft=draft_id, edit_ratio=ratio, rewritten=not mark_sent)
        if ratio < LEARN_FROM_RATIO:
            return

        existing = self.db.select(
            "style_rules", {"select": "id,rule,scope,contact_id,support_count", "user_id": f"eq.{row['user_id']}", "limit": "100"}
        )
        prompt = "\n".join(
            ["Existing rules:"]
            + [f"- {r['rule']}" for r in existing]
            + ["", "Draft:", draft_body, "", "What they sent:", row["body"]]
        )
        try:
            result = self.gemini.json(
                self.model, SYSTEM, prompt, SCHEMA, UsageContext(row["user_id"], "learn", thread["account_id"], row["thread_id"])
            )
        except GeminiError as err:
            log.warn("learning failed", draft=row["draft_id"], status=err.status)
            return

        by_text = {(r["rule"].strip().lower(), r["contact_id"]): r for r in existing}
        for item in (result.get("rules") or [])[:3]:
            text = (item.get("rule") or "").strip().replace("—", ", ")
            if not text or len(text) > 200:
                continue
            scope = "contact" if item.get("scope") == "contact" and contact_id else "global"
            key = (text.lower(), contact_id if scope == "contact" else None)
            if key in by_text:
                r = by_text[key]
                self.db.update("style_rules", {"id": f"eq.{r['id']}"}, {"support_count": r["support_count"] + 1})
            else:
                self.db.insert(
                    "style_rules",
                    {"user_id": row["user_id"], "scope": scope, "contact_id": contact_id if scope == "contact" else None, "rule": text},
                )
        log.info("rules learned", draft=row["draft_id"], rules=len(result.get("rules") or []))
