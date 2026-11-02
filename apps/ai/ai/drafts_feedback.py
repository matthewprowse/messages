"""Explicit feedback on drafts: the thumbs up or down (and the optional reason chip) a person gave a draft, stored on
drafts.feedback and drafts.feedback_reason by the app. This turns those rows into what signals.py shows its model,
beside the implicit signals it already reads (tones picked, instructions typed, drafts thrown away).

A thumbs down says what the edit ratio cannot: a draft that was sent after heavy fixing may still have been
"wrong facts" rather than "wrong voice". Reasons are a closed list, so nothing the person wrote ever reaches a
prompt through this file. Pure: no network, no database."""

from __future__ import annotations

from typing import Any

# What the app's reason chips mean, in the words the learning prompt is given. Anything else is ignored.
REASONS = {
    "too_formal": "too formal",
    "too_casual": "too casual",
    "too_long": "too long",
    "too_short": "too short",
    "wrong_facts": "wrong facts",
    "wrong_language": "wrong language",
    "not_like_me": "did not sound like them",
}
# Wrong facts and wrong language are about this one conversation, not how the person writes, so they teach no style rule.
CONTENT_REASONS = {"wrong_facts", "wrong_language"}
DRAFT_CHARS = 300


def rated(drafts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drafts with a thumb on them, newest first as given."""
    return [d for d in drafts if d.get("feedback") in ("up", "down")]


def down_lines(drafts: list[dict[str, Any]]) -> list[tuple[str, str]]:
    """(why, draft start) for each thumbs-down about style. A down without a reason says only that the draft was not
    wanted, which still counts; one whose reason is about the facts is left out."""
    out: list[tuple[str, str]] = []
    for d in rated(drafts):
        reason = d.get("feedback_reason")
        if d["feedback"] != "down" or reason in CONTENT_REASONS or not (d.get("body") or "").strip():
            continue
        out.append((REASONS.get(reason, "not good enough"), (d.get("body") or "")[:DRAFT_CHARS]))
    return out


def up_lines(drafts: list[dict[str, Any]]) -> list[str]:
    """The start of each draft marked as good, as examples of what to keep doing."""
    return [(d.get("body") or "")[:DRAFT_CHARS] for d in rated(drafts) if d["feedback"] == "up" and (d.get("body") or "").strip()]


def section(drafts: list[dict[str, Any]]) -> list[str]:
    """The prompt lines for signals.py: what they liked and what they marked down, with why."""
    down, up = down_lines(drafts), up_lines(drafts)
    lines = ["", "Drafts they marked as good (thumbs up), newest first:"] + ([f"--- {body}" for body in up] or ["(none)"])
    lines += ["", "Drafts they marked as not good (thumbs down), newest first, with why:"]
    lines += [f"--- Why: {why}\n{body}" for why, body in down] or ["(none)"]
    return lines
