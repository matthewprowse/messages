"""Learning from your sent mail. Learning from edits needs drafts you changed, so a new user has no
rules for a long time. This reads your own latest sent emails and writes down how you write
(greetings, sign-offs, length, formality) as global style rules, so drafts sound like you from the
start. It runs again every time you have sent VOICE_STEP more emails, typed replies and edited
drafts alike, and at most every VOICE_MIN_DAYS, so the rules follow how you write now. Only users with
new sent mail since the last pass are looked at (one cheap read of user ids), and the profile is read
before the count of sent mail, so the count is only made for a user who is otherwise due.

Rules already known gain support instead of being added twice. A rule from your sent mail that the
newest learning no longer finds is turned off (never deleted) and comes back if your mail shows it
again. A rule you turned off yourself stays off.

Email and WhatsApp are learned apart: each channel has its own counters on the profile, its own prompt and its own rules
(style_rules.channel), so email habits never end up in WhatsApp drafts."""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Any

from . import log
from .fields import BODY, HTML, STYLE_RULE
from .gemini import Gemini, GeminiError, UsageContext
from .supabase import Supabase, in_list
from .rules import rule_key, same_rule, tidy_rule  # noqa: F401  shared with learn.py and signals.py
from .text import clean
from .vault import Vault

MIN_EMAILS = 10  # fewer than this says too little about how someone writes
VOICE_STEP = 30  # learn again once this many more emails have been sent
VOICE_MIN_DAYS = 7  # and at least this long after the last time
PROBE_LIMIT = 1000
MAX_EMAILS = 40
EMAIL_CHARS = 800
PROMPT_CHARS = 24000
MAX_RULES = 8
LEARN_MAX_OUTPUT = 2048  # tokens, thinking included: a few short rules
RETRY_S = 3600  # after a failed or skipped attempt, try that user again an hour later

SCHEMA = {
    "type": "object",
    "properties": {
        "rules": {
            "type": "array",
            "maxItems": MAX_RULES,
            "items": {
                "type": "object",
                "properties": {
                    "rule": {"type": "string", "description": "One short, concrete instruction, e.g. 'Signs off with Matt, never Best'."},
                },
                "required": ["rule"],
            },
        }
    },
    "required": ["rules"],
}

SYSTEM = f"""You read emails one person wrote and sent, and write down how they write, so an assistant can
write new emails in their voice. Write up to {MAX_RULES} rules. Each rule is one short, concrete, reusable
instruction about their greetings, sign-offs, typical length, formality, phrases they use or avoid, or
punctuation and capitalisation habits. Only write a rule that most of the emails support.
Ignore what the emails are about (facts, dates, names of projects, decisions); describe style only.
If an existing rule still holds, repeat its wording exactly so it gains support. Leave out an existing
rule the emails no longer support or contradict; it will be turned off.
Never write a rule they turned off, or one that means the same.
Never use em dashes."""

# WhatsApp is its own voice: chat messages are short, often have no greeting or sign-off, and use emoji and slang that
# the same person's email never does. Its rules are kept apart (style_rules.channel) so neither leaks into the other.
WHATSAPP_SYSTEM = f"""You read WhatsApp messages one person wrote and sent, and write down how they write in chat, so an
assistant can write new WhatsApp messages in their voice. Write up to {MAX_RULES} rules. Each rule is one short, concrete,
reusable instruction about how they open (or do not), how they end, typical length, how they split a thought over
several short messages, emoji, slang and abbreviations, languages they mix, and punctuation and capitalisation habits.
Only write a rule that most of the messages support.
Ignore what the messages are about (facts, dates, names, decisions); describe style only.
If an existing rule still holds, repeat its wording exactly so it gains support. Leave out an existing
rule the messages no longer support or contradict; it will be turned off.
Never write a rule they turned off, or one that means the same.
Never use em dashes."""


def build_prompt(emails: list[str], existing: list[str], turned_off: list[str] | None = None, channel: str = "email") -> str:
    """Existing rules first, then the emails newest first, kept within PROMPT_CHARS."""
    noun = "Message" if channel == "whatsapp" else "Email"
    lines = ["Existing rules:"] + ([f"- {r}" for r in existing] or ["(none)"])
    if turned_off:
        lines += ["", "Rules they turned off:"] + [f"- {r}" for r in turned_off]
    lines += ["", f"{noun}s they sent, newest first:"]
    used = sum(len(line) + 1 for line in lines)
    for i, email in enumerate(emails, 1):
        block = f"--- {noun} {i}:\n{email}"
        if used + len(block) > PROMPT_CHARS:
            break
        lines.append(block)
        used += len(block) + 1
    return "\n".join(lines)


def wait_left(learned_at: str | None, now: datetime | None = None) -> float:
    """Seconds until VOICE_MIN_DAYS have passed since the last learning; 0 at first and once they have."""
    if learned_at is None:
        return 0.0
    try:
        then = datetime.fromisoformat(str(learned_at).replace("Z", "+00:00"))
    except ValueError:
        return 0.0
    return max(0.0, VOICE_MIN_DAYS * 86400 - ((now or datetime.now(timezone.utc)) - then).total_seconds())


def waited(learned_at: str | None, now: datetime | None = None) -> bool:
    return wait_left(learned_at, now) == 0.0


def voice_due(outbound: int, learned_outbound: int, learned_at: str | None, now: datetime | None = None) -> bool:
    """At first run once there is enough sent mail, then each time VOICE_STEP more have been sent, and at
    least VOICE_MIN_DAYS after the last time."""
    if outbound < MIN_EMAILS:
        return False
    return learned_at is None or (outbound - learned_outbound >= VOICE_STEP and waited(learned_at, now))


def plan_voice(existing: list[dict[str, Any]], learned: list[str], channel: str = "email") -> tuple[list[tuple[str, dict[str, Any]]], list[str]]:
    """Returns (updates as (id, patch), new rule texts).

    A learned rule matching an existing global rule of this channel (or one for every channel) supports it, whichever
    source it came from, and turns it back on if the AI had turned it off. Rules you turned off stay off. Global rules
    from sent mail on this channel that the newest learning did not repeat are turned off as unsupported; the other
    channel's rules are never touched. A rule without a channel is an email rule, as every rule was before channels."""
    globals_ = [r for r in existing if r.get("scope") == "global" and not r.get("contact_id") and r.get("channel", "email") in (channel, "any")]
    updates: dict[str, dict[str, Any]] = {}
    inserts: list[str] = []
    matched: set[str] = set()
    seen: list[str] = []
    for raw in learned[:MAX_RULES]:
        text = tidy_rule(raw)
        if not rule_key(text) or len(text) > 200 or any(same_rule(text, s) for s in seen):
            continue
        seen.append(text)
        r = next((r for r in globals_ if r["id"] not in matched and rule_key(r["rule"]) == rule_key(text)), None)
        r = r or next((r for r in globals_ if r["id"] not in matched and same_rule(r["rule"], text)), None)
        if r is None:
            inserts.append(text)
            continue
        matched.add(r["id"])
        patch: dict[str, Any] = {"support_count": int(r.get("support_count") or 1) + 1}
        if not r.get("enabled", True) and r.get("disabled_reason") == "unsupported":
            patch["enabled"] = True
        updates[r["id"]] = patch
    for r in globals_:
        if r["id"] not in matched and r.get("source") == "sent_mail" and r.get("enabled", True) and r.get("channel", "email") == channel:
            updates[r["id"]] = {"enabled": False, "disabled_reason": "unsupported"}
    return list(updates.items()), inserts


# The profile columns holding when, and after how many sent messages, each channel's voice was last learned.
COUNTERS = {"email": ("voice_learned_at", "voice_learned_outbound"), "whatsapp": ("voice_whatsapp_learned_at", "voice_whatsapp_learned_outbound")}


def slot_of(user_id: str, channel: str) -> str:
    """The key for one user's one channel in the retry timers; email keeps the bare user id it always had."""
    return user_id if channel == "email" else f"{user_id}:{channel}"


class Voice:
    def __init__(self, db: Supabase, gemini: Gemini, model: str, vault: Vault | None = None):
        self.db = db
        self.gemini = gemini
        self.model = model
        self.vault = vault or Vault(db)  # without one, plaintext passes through
        self._next: dict[str, float] = {}  # user_id -> monotonic time this process may try them again
        self._probed: str | None = None  # when sent mail was last checked for
        self._dirty: set[str] = set()  # users with new sent mail (or a wait still to run) since they were last looked at
        self._keep: set[str] = set()  # users _learn wants looked at again: held by VOICE_MIN_DAYS, or the attempt failed

    def run_once(self) -> int:
        """Looks only at users with sent mail created since the last pass (one read of user ids). The first pass,
        and one after a full probe, looks at everyone."""
        started = datetime.now(timezone.utc)
        params = {"select": "user_id", "direction": "eq.outbound", "limit": str(PROBE_LIMIT)}
        if self._probed:
            params["created_at"] = f"gte.{self._probed}"
        probe = self.db.select("messages", params)
        everyone = self._probed is None or len(probe) >= PROBE_LIMIT
        self._probed = (started - timedelta(minutes=1)).isoformat()  # a little back, so a row written during the read is not missed
        self._dirty |= {r["user_id"] for r in probe}
        if not self._dirty and not everyone:
            return 0
        accounts = self.db.select("accounts", {"select": "id,user_id,provider", "provider": "in.(icloud,gmail,outlook,whatsapp)", "status": "neq.disconnected"})
        by_user: dict[str, dict[str, list[str]]] = {}
        for a in accounts:
            by_user.setdefault(a["user_id"], {}).setdefault("whatsapp" if a.get("provider") == "whatsapp" else "email", []).append(a["id"])
        if everyone:
            self._dirty |= set(by_user)
        done = 0
        for user_id in sorted(self._dirty & set(by_user)):
            self._dirty.discard(user_id)
            for channel, ids in by_user[user_id].items():
                slot = slot_of(user_id, channel)
                if time.monotonic() < self._next.get(slot, 0.0):
                    self._keep.add(user_id)  # still dirty: looked at once the wait is over
                    continue
                try:  # one user's failure must not skip the others
                    if self._learn(user_id, ids, channel):
                        done += 1
                except Exception as err:
                    self._next[slot] = time.monotonic() + RETRY_S
                    self._keep.add(user_id)
                    log.warn("voice learning errored", user=user_id, channel=channel, code=log.code_of(err))
        self._dirty |= self._keep
        self._keep.clear()
        return done

    def _learn(self, user_id: str, account_ids: list[str], channel: str = "email") -> bool:
        """One channel's voice: email and WhatsApp are learned apart, each with its own counters on the profile and its
        own rules (style_rules.channel), so neither one's habits end up in the other's drafts."""
        slot = slot_of(user_id, channel)
        cols = COUNTERS[channel]
        profile = self.db.first("profiles", {"select": ",".join(cols), "user_id": f"eq.{user_id}"})
        if not profile:
            self._next[slot] = time.monotonic() + RETRY_S
            return False
        left = wait_left(profile.get(cols[0]))
        if left > 0:  # the count is not made until the wait is over, and the user is not looked at before then either
            self._next[slot] = time.monotonic() + left
            self._keep.add(user_id)
            return False
        sent_filter = {"user_id": f"eq.{user_id}", "account_id": in_list(account_ids), "direction": "eq.outbound"}
        outbound = self.db.count("messages", sent_filter)
        if not voice_due(outbound, int(profile.get(cols[1]) or 0), profile.get(cols[0])):
            return False

        self._next[slot] = time.monotonic() + RETRY_S
        sent = self.db.select("messages", {"select": "body_text,body_html", **sent_filter, "order": "sent_at.desc", "limit": str(MAX_EMAILS)})
        sent = [self.vault.open_row(user_id, m, [("body_text", BODY), ("body_html", HTML)]) for m in sent]
        emails = [t for t in (clean(m.get("body_text"), m.get("body_html"), limit=EMAIL_CHARS) for m in sent) if t]
        if len(emails) < MIN_EMAILS:
            return False

        existing = self.db.select(
            "style_rules",
            {"select": "id,rule,scope,contact_id,source,support_count,enabled,disabled_reason,channel", "user_id": f"eq.{user_id}", "limit": "200"},
        )
        for r in existing:  # rules written sealed are opened here; plain ones pass through
            r["rule"] = self.vault.open(user_id, STYLE_RULE, r.get("rule")) or ""
        global_rules = [r for r in existing if r["scope"] == "global" and r.get("channel", "email") in (channel, "any")]
        prompt = build_prompt(
            emails,
            [r["rule"] for r in global_rules if r["enabled"]],
            [r["rule"] for r in global_rules if not r["enabled"] and r.get("disabled_reason") == "user"],
            channel,
        )
        try:
            result = self.gemini.json(self.model, WHATSAPP_SYSTEM if channel == "whatsapp" else SYSTEM, prompt, SCHEMA, UsageContext(user_id, "learn"), max_output=LEARN_MAX_OUTPUT)
        except GeminiError as err:
            log.warn("voice learning failed", user=user_id, status=err.status)
            self._keep.add(user_id)
            return False

        learned = [item.get("rule") or "" for item in (result.get("rules") or []) if isinstance(item, dict)]
        updates, inserts = plan_voice(existing, learned, channel)
        now = datetime.now(timezone.utc).isoformat()
        for rule_id, patch in updates:
            self.db.update("style_rules", {"id": f"eq.{rule_id}", "user_id": f"eq.{user_id}"}, {**patch, "updated_at": now}, minimal=True)
        if inserts:
            self.db.insert(
                "style_rules",
                [{"user_id": user_id, "scope": "global", "contact_id": None, "rule": self.vault.seal(user_id, STYLE_RULE, text), "source": "sent_mail", "channel": channel} for text in inserts],
            )
        self.db.update("profiles", {"user_id": f"eq.{user_id}"}, {cols[0]: now, cols[1]: outbound}, minimal=True)
        turned_off = sum(1 for _, p in updates if p.get("enabled") is False)
        log.info("voice learned", user=user_id, channel=channel, emails=len(emails), added=len(inserts), supported=len(updates) - turned_off, turned_off=turned_off)
        return True
