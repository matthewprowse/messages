"""How the three learners (learn.py from edits, voice.py from sent mail, signals.py from steering) compare, clean and
match style rules, in one place so they cannot drift apart: the same fuzzy match, the same dash cleanup, and the same
rule for when a rule learned from edits goes live. Pure."""

from __future__ import annotations

import difflib
import re
import statistics
from typing import Any

from .text import plain_dashes

SAME_RULE = 0.88  # wording this close to an existing rule is that rule
MIN_SUPPORT = 2  # a rule seen in a single edit stays off ("tentative") until a second one supports it
MEDIAN_AFTER = 20  # outcomes before the median is trusted


def rule_key(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower()).rstrip(".")


def tidy_rule(text: str) -> str:
    """The app never shows dashes; the model sometimes writes them anyway."""
    return re.sub(r"\s+", " ", plain_dashes(text)).strip()


def same_rule(a: str, b: str) -> bool:
    ka, kb = rule_key(a), rule_key(b)
    return ka == kb or difflib.SequenceMatcher(None, ka, kb, autojunk=False).ratio() >= SAME_RULE


def find_rule(rules: list[dict[str, Any]], text: str, contact_id: str | None = None) -> dict[str, Any] | None:
    """The existing rule (for this contact, or the global ones when contact_id is None) that text rewords."""
    return next((r for r in rules if r.get("contact_id") == contact_id and same_rule(r["rule"], text)), None)


def goes_live(support: int) -> bool:
    return support >= MIN_SUPPORT


def worth_learning(ratio: float, recent: list[float]) -> bool:
    """Learn from how the person usually edits, not from every edit: once there are MEDIAN_AFTER outcomes, an edit
    smaller than their median edit says nothing new about them, so it is recorded but not sent to the model."""
    return len(recent) < MEDIAN_AFTER or ratio >= statistics.median(recent)
