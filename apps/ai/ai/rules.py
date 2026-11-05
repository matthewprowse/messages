"""How the three learners (learn.py from edits, voice.py from sent mail, signals.py from steering) compare, clean and
match style rules, in one place so they cannot drift apart: the same fuzzy match, the same dash cleanup, the same
check that a rule is about style and nothing a sender could plant, and the same rule for when a learned rule goes live.
Pure."""

from __future__ import annotations

import difflib
import re
import statistics
from typing import Any

from .text import plain_dashes

SAME_RULE = 0.88  # wording this close to an existing rule is that rule
MIN_SUPPORT = 2  # a rule seen in a single edit stays off ("tentative") until a second one supports it
MEDIAN_AFTER = 20  # outcomes before the median is trusted
RULE_CHARS = 200  # a style rule is one short sentence; anything longer is not one

# A rule is learned from text other people can shape (their mail quoted in a reply, drafts written from it) and then goes
# into every draft. So a rule may only describe style: one carrying an address, a link, a long number or a word about
# recipients or payment ("always CC x", "bank details are ...") is dropped, whatever the model meant by it. Addresses
# and links are also caught spelled out ("accounts at konva-pay dot co dot za", "[at]", "(dot)"), numbers written as
# words count as digits, and the payment and recipient words cover Afrikaans and South African banks: this is the
# filter between a sender's mail and every future draft, and it is applied again when rules are read, so a rule
# stored before a word was on the list is caught then.
_ADDRESS = re.compile(r"@|\b(?:at|by)\b\s*[\[(]?\s*\w[\w-]*\s*[\])]?\s*[\[(]?\s*dot\s*[\])]?\s*\w", re.I)
_LINK = re.compile(
    r"https?://|www\.|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}\b"
    r"|\[(?:at|dot)\]|\((?:at|dot)\)|\b\w[\w-]*\s+dot\s+(?:co\s+za|com|org|net|za|io|me|africa)\b",
    re.I,
)
_DIGITS = re.compile(r"(?:\d[\s.\-/]?){6,}")  # a phone, account or reference number, with or without spaces
_NUMBER_WORDS = re.compile(r"\b(?:(?:zero|one|two|three|four|five|six|seven|eight|nine|nul|een|twee|drie|vier|vyf|ses|sewe|agt|nege)[\s,-]*){6,}\b", re.I)
_PLANTED = re.compile(
    r"\b(?:b?cc|iban|swift|bank(?:ing)?|account (?:number|no|details|holder)|password|passcode|otp|wire|crypto|bitcoin|"
    r"gift ?cards?|payment details|proof of payment|pop|eft|branch code|sort code|routing|beneficiary|"
    r"reply(?:-| )to (?:\S+ ){0,3}(?:address|mailbox|e-?mail|inbox)|copy in|forward (?:it|this|them|everything|all|mail|emails?) to|send (?:it|them|this|everything|all|mail|emails?) to|new (?:email |e-mail )?address|"
    r"bankbesonderhede|bank ?besonderhede|rekening(?:nommer|besonderhede)?|betaal|betaling|takkode|begunstigde|"
    r"stuur (?:dit |hulle )?(?:aan|na)|nuwe (?:e-?pos)?adres|"
    r"capitec|fnb|first national bank|absa|nedbank|standard bank|investec|discovery bank|tymebank|african bank|bidvest bank)\b",
    re.I,
)


def rule_key(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower()).rstrip(".")


def tidy_rule(text: str) -> str:
    """The app never shows dashes; the model sometimes writes them anyway."""
    return re.sub(r"\s+", " ", plain_dashes(text)).strip()


def safe_rule(text: str) -> bool:
    """False for a rule that carries an address, a link or domain, a long digit run, or a word about recipients or
    payment: those are never style, and are how a sender would plant an instruction in every future draft."""
    return not (_ADDRESS.search(text) or _LINK.search(text) or _DIGITS.search(text) or _NUMBER_WORDS.search(text) or _PLANTED.search(text))


def learnable(text: str) -> bool:
    """A tidied rule that may be stored: not empty, one short sentence, and safe_rule."""
    return bool(rule_key(text)) and len(text) <= RULE_CHARS and safe_rule(text)


def same_rule(a: str, b: str) -> bool:
    ka, kb = rule_key(a), rule_key(b)
    return ka == kb or difflib.SequenceMatcher(None, ka, kb, autojunk=False).ratio() >= SAME_RULE


def find_rule(rules: list[dict[str, Any]], text: str, contact_id: str | None = None) -> dict[str, Any] | None:
    """The existing rule (for this contact, or the global ones when contact_id is None) that text rewords."""
    return next((r for r in rules if r.get("contact_id") == contact_id and same_rule(r["rule"], text)), None)


def goes_live(support: int) -> bool:
    return support >= MIN_SUPPORT


def promoted(rule: dict[str, Any], support: int) -> bool:
    """Whether a tentative rule (seen once, stored off) now has the support to go live. A rule turned off for any other
    reason is not switched on here."""
    return rule.get("disabled_reason") == "tentative" and not rule.get("enabled", False) and goes_live(support)


# What a learned rule is stored with the first time it is seen: off until a second pass supports it (rules.MIN_SUPPORT).
TENTATIVE = {"enabled": False, "disabled_reason": "tentative"}


def worth_learning(ratio: float, recent: list[float]) -> bool:
    """Learn from how the person usually edits, not from every edit: once there are MEDIAN_AFTER outcomes, an edit
    smaller than their median edit says nothing new about them, so it is recorded but not sent to the model."""
    return len(recent) < MEDIAN_AFTER or ratio >= statistics.median(recent)
