"""Triage's extras that ride along in the same model call: why a conversation got its label (a closed reason code plus a
few words), a flag for likely phishing or payment fraud, and at most one of the user's Auto labels. Also the rule that
decides whether the label may be put on, and the cheap summary for junk. Pure: no network, no database.

The model only ever returns a code from a closed list and the number of an Auto label, never text that is trusted:
the words that go with a reason are cut and cleaned here, and a label is found by its number in the list we sent."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

MAX_AUTO_LABELS = 6  # the database refuses a seventh (limit_auto_labels)
REASON_WORDS_MAX = 60  # characters of free text next to a reason code
SUBJECT_SUMMARY_CHARS = 200

# What the model may say. The phrase is what shows when it gave no words of its own.
MODEL_REASONS = {
    "deadline": "Deadline soon",
    "asked_you": "You were asked something",
    "waiting_on_you": "Someone is waiting on you",
    "client_important": "Looks important to your work",
    "personal": "A person writing to you",
    "bulk_mail": "Bulk mail",
    "newsletter": "Newsletter",
    "promotion": "Marketing",
    "automated": "Automated message",
    "receipt_or_bill": "Receipt or bill",
    "security": "Security notice",
    "other": "Sorted by the AI",
}
# Decided by the user's own signals, never by the model. These are what "Because you ..." reads like.
RULE_REASONS = {
    "rule_always": "Marked always important by you",
    "rule_never": "Marked never important by you",
    "vip": "Starred contact",
    "unsubscribed": "You unsubscribed from this sender",
    "marked_junk": "You marked this conversation Junk",
    "marked_not_junk": "You marked this conversation Not Junk",
    "marked_important": "You marked this conversation Important",
    "marked_not_important": "You marked this conversation Not Important",
    "sender_settled": "Bulk sender you never answer",
    "no_reply_needed": "You said no reply is needed",
    "copied": "Same email as in another account",
    "automation": "Your automation marked this urgent",
}
REASONS = list(MODEL_REASONS)
SUSPICIOUS_KINDS = ["none", "payment_change", "phishing", "impersonation"]
LABEL_CHOICES = ["none"] + [str(i) for i in range(1, MAX_AUTO_LABELS + 1)]


@dataclass
class AutoLabel:
    id: str
    name: str
    description: str


def reason_phrase(code: str) -> str:
    return MODEL_REASONS.get(code) or RULE_REASONS.get(code) or MODEL_REASONS["other"]


def read_reason(item: dict[str, Any]) -> tuple[str, str]:
    """(code, words) from one model answer: an unknown code becomes "other", the words are one line cut to
    REASON_WORDS_MAX, and the code's own phrase stands in when there are none."""
    code = item.get("reason") if item.get("reason") in MODEL_REASONS else "other"
    words = " ".join(str(item.get("reason_text") or "").split())[:REASON_WORDS_MAX].strip()
    return code, words or MODEL_REASONS[code]


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
