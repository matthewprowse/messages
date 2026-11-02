"""When: whether a new email meets an automation's conditions. Pure, so it is the same for the live run and the 30 day preview.

Sender entries are an address (has an @, matched whole) or a domain (matched as the domain or any subdomain of it), so
"property24.com" also covers "mail.property24.com". Words are matched without regard to case anywhere in the subject or body."""

from __future__ import annotations

from .spec import When


def sender_matches(entries: tuple[str, ...], address: str | None) -> bool:
    """Whether the sender's address is one of the entries or in one of the domains."""
    sender = (address or "").strip().lower()
    if not sender:
        return False
    domain = sender.rpartition("@")[2]
    for e in entries:
        if "@" in e:
            if sender == e.lower():
                return True
        else:
            d = e.lower().lstrip("@")
            if domain == d or domain.endswith("." + d):
                return True
    return False


def _has_any(words: tuple[str, ...], text: str) -> bool:
    low = text.lower()
    return any(w.lower() in low for w in words)


def matches(when: When, *, account_id: str | None, sender: str | None, subject: str | None, body: str | None) -> bool:
    """Whether the email meets every condition the automation sets. An automation with no condition never matches."""
    if not when.has_condition():
        return False
    if when.accounts and account_id not in when.accounts:
        return False
    if when.senders and not sender_matches(when.senders, sender):
        return False
    subject, body = subject or "", body or ""
    if when.subject and not _has_any(when.subject, subject):
        return False
    if when.body and not _has_any(when.body, body):
        return False
    return not when.anywhere or _has_any(when.anywhere, subject) or _has_any(when.anywhere, body)


def pre_matches(when: When, *, account_id: str | None, sender: str | None, subject: str | None) -> bool:
    """The part of matches() that needs no body: account, sender and subject. False means the email is ruled out and its body
    is never fetched; True means it might match once the body is read."""
    if when.accounts and account_id not in when.accounts:
        return False
    if when.senders and not sender_matches(when.senders, sender):
        return False
    return not when.subject or _has_any(when.subject, subject or "")
