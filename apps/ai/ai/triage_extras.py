"""Triage's extras that ride along in the same model call: a flag for likely phishing or payment fraud, and at most one
of the user's Auto labels. Also the rule that decides whether the label may be put on, and the cheap summary for junk.
Pure: no network, no database.

The model only ever returns a code from a closed list and the number of an Auto label, never text that is trusted:
a label is found by its number in the list we sent.

The model's suspicious flag can be talked down by the email it reads, so header_suspicion adds checks made in code that
it cannot change (a display name carrying another address or domain, a Reply-To elsewhere, failed SPF, DKIM or DMARC),
and the flag stored is the stronger of the two. twin_key says when two rows are the same email for copying a verdict."""

from __future__ import annotations

import hashlib
import re
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


# Second-level labels under a country code, so "mail.acme.co.za" is the brand "acme", as "acme.com" is.
_SECOND_LEVEL = {"co", "com", "org", "net", "ac", "gov", "edu", "ltd", "plc", "nom", "web"}
_EMAIL_IN = re.compile(r"[\w.+-]+@([\w-]+(?:\.[\w-]+)+)")
# A domain shown in a display name ("PayPal.com Support"). Only common endings count, so "St.John" or "J.Smith" is a name.
_TLDS = "com|net|org|info|biz|io|co|ai|app|dev|me|online|site|xyz|shop|store|email|support|live|africa|za|uk|us|eu|de|fr|nl|au|ca|in|ng|ke"
_DOMAIN_IN = re.compile(rf"\b((?:[a-z0-9-]+\.)+(?:{_TLDS}))\b", re.I)
_PASS = "pass"


def brand_of(domain: str) -> str:
    """The name a domain is registered under, without its suffix: "acme" for acme.com, mail.acme.co.za and acme.co.uk."""
    labels = [p for p in domain.lower().strip(".").split(".") if p]
    if len(labels) < 2:
        return labels[0] if labels else ""
    if len(labels) >= 3 and len(labels[-1]) == 2 and labels[-2] in _SECOND_LEVEL:
        return labels[-3]
    return labels[-2]


def _domain(address: str | None) -> str:
    return (address or "").rsplit("@", 1)[-1].strip().strip(">").lower() if "@" in (address or "") else ""


def auth_failed(auth: Any) -> bool:
    """True when the receiving server's checks say the From was not sent by its domain: DMARC failed, or neither SPF nor
    DKIM passed. Absent (older rows, chats, providers that do not say) is not a failure."""
    if not isinstance(auth, dict) or not auth:
        return False
    verdict = lambda key: str(auth.get(key) or "none").strip().lower()
    return verdict("dmarc") == "fail" or (verdict("spf") != _PASS and verdict("dkim") != _PASS)


def header_suspicion(name: str | None, sender: str | None, auth: Any = None, reply_to_domain: str | None = None, name_mismatch: Any = None) -> str | None:
    """impersonation when the headers say the sender is not who the mail claims, else None. Checked in code, so nothing
    in the email can argue it away: a display name that carries an email address or a domain of another brand than the
    sender's ("PayPal Support <x@evil.biz>", "billing@acme.com <x@gmail.com>"), a Reply-To at another brand, or failed
    authentication. sender is the From address; name is the display name the contact is stored under; auth is
    provider_meta.auth; reply_to_domain is provider_meta.reply_to_domain (the worker keeps only the domain, and only
    when it is not the From address's); name_mismatch is provider_meta.name_mismatch, which the worker sets when the
    message's own From display name named another brand (the stored contact name may be the person's real one, which
    would hide that)."""
    domain = _domain(sender)
    if not domain:
        return None
    if name_mismatch is True:
        return "impersonation"
    mine = brand_of(domain)
    shown = name or ""
    for found in _EMAIL_IN.findall(shown) + [m for m in _DOMAIN_IN.findall(shown) if "@" not in m]:
        if brand_of(found) != mine:
            return "impersonation"
    other = (reply_to_domain or "").strip().strip(".").lower() if isinstance(reply_to_domain, str) else ""
    if other and brand_of(other) != mine:  # mail.acme.com replying for acme.com is the same brand
        return "impersonation"
    return "impersonation" if auth_failed(auth) else None


def stronger_suspicion(model: str | None, rules: str | None) -> str | None:
    """The flag to store: the model's own kind when it gave one (it says more), otherwise what the header checks found.
    The model can add a warning but never take one away."""
    return model if model in SUSPICIOUS_KINDS[1:] else rules if rules in SUSPICIOUS_KINDS[1:] else None


def twin_key(m: dict[str, Any]) -> tuple[str, str, str, str]:
    """When two incoming rows are one email (the same mail in two of the user's accounts): the same Message-ID, the
    same sender and the same subject. A Message-ID alone is chosen by the sender, so a forged one could borrow a verdict."""
    sender = m.get("sender_index") or (m.get("sender_address") or "").strip().lower()
    subject = hashlib.sha256(" ".join(str(m.get("subject") or "").split()).lower().encode()).hexdigest()[:16]
    return (m["user_id"], m.get("provider_message_id") or m["id"], sender, subject)


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
