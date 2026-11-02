"""Learning from how you steer drafts. The tone chips you pick (Shorter, More Formal, More Casual),
the instructions you type, the guided drafting choices you pick and what you then sent, and the drafts
you throw away all say something about how drafts should be written. A tone picked again and again
becomes a rule directly; the rest are read by the model, which writes rules only for patterns that
repeat, such as how you confirm a time or turn something down.

These rules have the source 'signals'. When the pattern stops (you no longer pick that tone, or the
newest instructions no longer say it) the rule is turned off, not deleted, and comes back if it
returns. A rule you turned off yourself stays off."""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Any

from . import log
from .fields import BODY, DRAFT, INSTRUCTION, STYLE_RULE
from .gemini import Gemini, GeminiError, UsageContext
from .drafts_feedback import down_lines, rated, section as feedback_section
from .supabase import Supabase, in_list
from .vault import Vault
from .voice import rule_key, same_rule, tidy_rule

WINDOW_DAYS = 45
MIN_TONE = 3  # times a tone must be picked in the window
MIN_TONE_SHARE = 0.3  # and its share of all drafts asked for
MIN_SIGNALS = 3  # instructions or thrown away drafts needed before the model is asked
MAX_RULES = 3
SAMPLES = 20
DRAFT_CHARS = 300
LEARN_MAX_OUTPUT = 2048  # tokens, thinking included: a few short rules
RECHECK_S = 3600

TONE_RULES = {
    "shorter": "Keeps replies short: only what is needed, no extra pleasantries.",
    "formal": "Writes more formally than a typical draft.",
    "casual": "Writes casually and relaxed, never stiff.",
}

SCHEMA = {
    "type": "object",
    "properties": {
        "rules": {
            "type": "array",
            "maxItems": MAX_RULES,
            "items": {
                "type": "object",
                "properties": {"rule": {"type": "string", "description": "One short, concrete instruction for future drafts."}},
                "required": ["rule"],
            },
        }
    },
    "required": ["rules"],
}

SYSTEM = f"""An assistant writes email drafts for one person. You see the instructions they typed when asking
for drafts, the one-tap choices they picked (accept, decline, other time, answer) with what they decided
and the reply they finally sent, and drafts they threw away without sending. Write up to {MAX_RULES} short,
concrete, reusable style rules for future drafts, only for patterns that repeat (at least two signals
point the same way). Example: repeated "make it shorter" means "Keeps replies to two or three
sentences." From choices, learn how they word that kind of answer, such as "When confirming a time,
repeats the day, time and place." Ignore one-off content (facts, dates, what to say this time).
If an existing rule still holds, repeat its wording exactly. Leave out existing rules the newest signals
no longer support. Return no rules if nothing repeats. Never use em dashes."""


def tone_counts(drafts: list[dict[str, Any]]) -> dict[str, int]:
    """Tones picked often enough, and often enough compared with all drafts, to be a habit."""
    counts: dict[str, int] = {}
    for d in drafts:
        tone = d.get("tone") or "default"
        if tone in TONE_RULES:
            counts[tone] = counts.get(tone, 0) + 1
    total = len(drafts)
    return {t: n for t, n in counts.items() if n >= MIN_TONE and total and n / total >= MIN_TONE_SHARE}


def build_prompt(existing: list[str], instructions: list[str], thrown_away: list[tuple[str, str]], choices: list[tuple[str, str, str]] | None = None, rated_drafts: list[dict[str, Any]] | None = None) -> str:
    """choices are (kind, what they decided, what they sent or "" when the draft was not sent)."""
    lines = ["Existing rules from these signals:"] + ([f"- {r}" for r in existing] or ["(none)"])
    lines += ["", "Instructions they typed, newest first:"] + ([f"- {i}" for i in instructions] or ["(none)"])
    lines += ["", "Choices they picked, newest first:"]
    lines += [f"--- Picked: {kind.replace('_', ' ')}: {decision}\nThey sent: {sent or '(nothing yet)'}" for kind, decision, sent in choices or []] or ["(none)"]
    lines += ["", "Drafts they threw away without sending, newest first:"]
    lines += [f"--- Tone asked: {tone}\n{body}" for tone, body in thrown_away] or ["(none)"]
    if rated_drafts:  # thumbs up and down given on drafts (drafts_feedback.py)
        lines += feedback_section(rated_drafts)
    return "\n".join(lines)


def _is_tone_rule(text: str) -> bool:
    return any(rule_key(text) == rule_key(t) for t in TONE_RULES.values())


def plan_signals(
    existing: list[dict[str, Any]], tones: dict[str, int], learned: list[str] | None
) -> tuple[list[tuple[str, dict[str, Any]]], list[tuple[str, int]]]:
    """Returns (updates as (id, patch), inserts as (text, support_count)).

    existing is the user's 'signals' rules. Tone rules follow tones exactly. Other rules follow learned,
    the model's newest answer, or are left alone when learned is None (the model was not asked)."""
    updates: dict[str, dict[str, Any]] = {}
    inserts: list[tuple[str, int]] = []

    def switch_on(r: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
        if not r.get("enabled", True) and r.get("disabled_reason") == "unsupported":
            patch["enabled"] = True
        return patch

    def switch_off(r: dict[str, Any]) -> None:
        if r.get("enabled", True):
            updates[r["id"]] = {"enabled": False, "disabled_reason": "unsupported"}

    tone_rows = [r for r in existing if _is_tone_rule(r["rule"])]
    other_rows = [r for r in existing if not _is_tone_rule(r["rule"])]

    for tone, text in TONE_RULES.items():
        row = next((r for r in tone_rows if rule_key(r["rule"]) == rule_key(text)), None)
        if tone in tones:
            if row is None:
                inserts.append((text, tones[tone]))
            else:
                patch = switch_on(row, {})
                if int(row.get("support_count") or 1) != tones[tone]:
                    patch["support_count"] = tones[tone]
                if patch:
                    updates[row["id"]] = patch
        elif row is not None:
            switch_off(row)

    if learned is not None:
        matched: set[str] = set()
        seen: list[str] = []
        for raw in learned[:MAX_RULES]:
            text = tidy_rule(raw)
            if not rule_key(text) or len(text) > 200 or _is_tone_rule(text) or any(same_rule(text, s) for s in seen):
                continue
            seen.append(text)
            row = next((r for r in other_rows if r["id"] not in matched and same_rule(r["rule"], text)), None)
            if row is None:
                inserts.append((text, 1))
                continue
            matched.add(row["id"])
            updates[row["id"]] = switch_on(row, {"support_count": int(row.get("support_count") or 1) + 1})
        for r in other_rows:
            if r["id"] not in matched:
                switch_off(r)
    return list(updates.items()), inserts


class Signals:
    def __init__(self, db: Supabase, gemini: Gemini, model: str, vault: Vault | None = None):
        self.db = db
        self.gemini = gemini
        self.model = model
        self.vault = vault or Vault(db)  # without one, plaintext passes through
        self._seen: dict[str, str] = {}  # user_id -> newest signal draft the model has read
        self._next: dict[str, float] = {}
        self._probed: str | None = None  # when drafts were last checked for changes
        self._dirty: set[str] = set()  # users whose drafts changed and who are waiting out RECHECK_S

    def run_once(self) -> int:
        """Looks only at users whose drafts changed since the last run (a cheap read of user ids), then reads those
        users' drafts with bodies. The first run looks at everyone with drafts in the window."""
        started = datetime.now(timezone.utc)
        since = (started - timedelta(days=WINDOW_DAYS)).isoformat()
        filters = {"status": "in.(active,sent,discarded)", "tone": "neq.edit"}  # edits of your own text say nothing about how drafts are written
        probe = self.db.select(
            "drafts",
            {
                "select": "user_id",
                **filters,
                "created_at": f"gte.{since}",
                **({"updated_at": f"gte.{self._probed}"} if self._probed else {}),
                "limit": "1000",
            },
        )
        self._probed = (started - timedelta(minutes=1)).isoformat()  # a little back, so a row written during the read is not missed
        self._dirty |= {r["user_id"] for r in probe}
        due = sorted(u for u in self._dirty if time.monotonic() >= self._next.get(u, 0.0))
        changed = 0
        for user_id in due:
            self._next[user_id] = time.monotonic() + RECHECK_S
            self._dirty.discard(user_id)
            mine = self.db.select(
                "drafts",
                {
                    "select": "id,user_id,tone,instruction,decision,decision_kind,status,body,created_at,feedback,feedback_reason",
                    **filters,
                    "user_id": f"eq.{user_id}",
                    "created_at": f"gte.{since}",
                    "order": "created_at.desc",
                    "limit": "300",
                },
            )
            for d in mine:
                self.vault.open_row(user_id, d, [("instruction", INSTRUCTION), ("decision", INSTRUCTION), ("body", DRAFT)])
            try:  # one user's failure must not skip the others
                changed += self._learn(user_id, mine)
            except Exception as err:
                log.warn("signal learning errored", user=user_id, code=log.code_of(err))
        return changed

    def _learn(self, user_id: str, drafts: list[dict[str, Any]]) -> int:
        existing = self.db.select(
            "style_rules",
            {"select": "id,rule,support_count,enabled,disabled_reason", "user_id": f"eq.{user_id}", "source": "eq.signals", "scope": "eq.global"},
        )
        for r in existing:  # rules written sealed are opened here; plain ones pass through
            r["rule"] = self.vault.open(user_id, STYLE_RULE, r.get("rule")) or ""
        signal_drafts = [d for d in drafts if (d.get("instruction") or "").strip() or d.get("decision_kind") or (d["status"] == "discarded" and d.get("body")) or d.get("feedback") in ("up", "down")]
        instructions = [d["instruction"].strip()[:300] for d in drafts if (d.get("instruction") or "").strip()][:SAMPLES]
        thrown_away = [(d.get("tone") or "default", (d.get("body") or "")[:DRAFT_CHARS]) for d in drafts if d["status"] == "discarded" and d.get("body")][:SAMPLES]
        picked = [d for d in drafts if d.get("decision_kind") and (d.get("decision") or "").strip()][:SAMPLES]

        learned: list[str] | None = None
        newest = signal_drafts[0]["id"] if signal_drafts else ""
        enough = len(instructions) >= MIN_SIGNALS or len(thrown_away) >= MIN_SIGNALS or len(picked) >= MIN_SIGNALS or len(down_lines(drafts)) >= MIN_SIGNALS
        if enough and self._seen.get(user_id) != newest:
            choices = [(d["decision_kind"], d["decision"].strip()[:300], sent) for d, sent in zip(picked, self._sent_bodies(user_id, picked))]
            prompt = build_prompt([r["rule"] for r in existing if r["enabled"] and not _is_tone_rule(r["rule"])], instructions, thrown_away, choices, rated(drafts)[:SAMPLES])
            try:
                result = self.gemini.json(self.model, SYSTEM, prompt, SCHEMA, UsageContext(user_id, "learn"), max_output=LEARN_MAX_OUTPUT)
                learned = [item.get("rule") or "" for item in (result.get("rules") or []) if isinstance(item, dict)]
                self._seen[user_id] = newest
            except GeminiError as err:
                log.warn("signal learning failed", user=user_id, status=err.status)

        updates, inserts = plan_signals(existing, tone_counts(drafts), learned)
        now = datetime.now(timezone.utc).isoformat()
        for rule_id, patch in updates:
            self.db.update("style_rules", {"id": f"eq.{rule_id}", "user_id": f"eq.{user_id}"}, {**patch, "updated_at": now}, minimal=True)
        if inserts:
            self.db.insert(
                "style_rules",
                [
                    {"user_id": user_id, "scope": "global", "contact_id": None, "rule": self.vault.seal(user_id, STYLE_RULE, text), "source": "signals", "support_count": n}
                    for text, n in inserts
                ],
            )
        if updates or inserts:
            log.info("signal rules", user=user_id, drafts=len(drafts), added=len(inserts), changed=len(updates))
        return len(updates) + len(inserts)

    def _sent_bodies(self, user_id: str, picked: list[dict[str, Any]]) -> list[str]:
        """What was finally sent from each guided draft, in the same order ("" for one not sent)."""
        sent_ids = [d["id"] for d in picked if d["status"] == "sent"]
        outcomes = (
            self.db.select("draft_outcomes", {"select": "draft_id,sent_body", "draft_id": in_list(sent_ids), "user_id": f"eq.{user_id}"})
            if sent_ids else []
        )
        by_draft = {o["draft_id"]: self.vault.open(user_id, BODY, o.get("sent_body")) or "" for o in outcomes}
        return [(by_draft.get(d["id"]) or "")[:DRAFT_CHARS] for d in picked]
