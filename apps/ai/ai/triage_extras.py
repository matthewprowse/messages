"""Triage's extras that ride along in the same model call: a flag for likely phishing or payment fraud, and at most one
of the user's Auto labels. Also the rule that decides whether the label may be put on, and the cheap summary for junk.
Pure: no network, no database.

The model only ever returns a code from a closed list and the number of an Auto label, never text that is trusted:
a label is found by its number in the list we sent."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

MAX_AUTO_LABELS = 6  # the database refuses a seventh (limit_auto_labels)
SUBJECT_SUMMARY_CHARS = 200

SUSPICIOUS_KINDS = ["none", "payment_change", "phishing", "impersonation"]
LABEL_CHOICES = ["none"] + [str(i) for i in range(1, MAX_AUTO_LABELS + 1)]


@dataclass
class AutoLabel:
    id: str
    name: str
    description: str


def read_suspicious(item: dict[str, Any]) -> str | None:
    """payment_change, phishing or impersonation, or None. Anything else the model says counts as not suspicious."""
    value = item.get("suspicious")
    return value if value in SUSPICIOUS_KINDS[1:] else None


def read_label(item: dict[str, Any], count: int) -> int | None:
    """The 1-based number of the Auto label the model chose, or None for none, junk or a number we did not offer."""
    try:
        n = int(str(item.get("label") or "none"))
    except ValueError:
        return None
    return n if 1 <= n <= min(count, MAX_AUTO_LABELS) else None


def label_lines(labels: list[AutoLabel]) -> str:
    """The numbered list for the prompt. Names and descriptions are the user's own words but go between marked lines anyway."""
    return "\n".join(f"{i}. {l.name}: {l.description}" if l.description else f"{i}. {l.name}" for i, l in enumerate(labels[:MAX_AUTO_LABELS], 1))


def label_to_add(labels: list[AutoLabel], picked: int | None, on_thread: set[str], removed: set[str]) -> str | None:
    """The id of the Auto label to put on a conversation, or None. At most one Auto label per conversation, so none when
    it already wears one; and never one the user took off it before."""
    if not picked or picked > len(labels):
        return None
    chosen = labels[picked - 1].id
    if chosen in removed or any(l.id in on_thread for l in labels):
        return None
    return chosen


def with_subject_summary(result: dict[str, Any], subject: str | None) -> dict[str, Any]:
    """Junk costs no summary: the model leaves it empty and the subject stands in, as it does for mail triage skips."""
    if (result.get("summary") or "").strip():
        return result
    return {**result, "summary": (subject or "")[:SUBJECT_SUMMARY_CHARS]}
