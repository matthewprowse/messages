"""Phone numbers from enquiry emails into E.164, so a repeat enquirer matches their contact whichever way the number was typed.
South African numbers (082 123 4567, +27 82 123 4567, 0027821234567, 27821234567) become +27821234567; another country's number
is kept only when it was written with its + (or 00) and a plausible length. Pure."""

from __future__ import annotations

import re

# A run of digits with the usual separators, at least 9 digits, so a price or a year is not read as a number.
PHONE_RE = re.compile(r"(?<![\w@.])(?:\+|00)?\d(?:[\s().-]?\d){8,14}(?![\w@])")


def normalise_phone(value: str | None) -> str | None:
    """The number in +E.164 form, or None when the text is not a plausible phone number."""
    text = (value or "").strip()
    if not text:
        return None
    plus = text.startswith("+") or text.startswith("00")
    digits = re.sub(r"\D", "", text)
    if text.startswith("00"):
        digits = digits[2:]
    if plus:
        if digits.startswith("27"):
            return f"+{digits}" if len(digits) == 11 else None
        return f"+{digits}" if 8 <= len(digits) <= 15 and not digits.startswith("0") else None
    if len(digits) == 10 and digits.startswith("0"):
        return f"+27{digits[1:]}"
    if len(digits) == 11 and digits.startswith("27"):
        return f"+{digits}"
    return None


def find_phone(text: str | None) -> str | None:
    """The first plausible phone number written anywhere in text, normalised."""
    for m in PHONE_RE.finditer(text or ""):
        found = normalise_phone(m.group(0))
        if found:
            return found
    return None
