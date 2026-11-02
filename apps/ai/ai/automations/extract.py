"""Read by Gemini: structured extraction of the fields an automation named, for a custom automation or a template whose email
changed so its fixed parser failed. Billed under the "automations" feature (its own share of fair usage).

The email is other people's text. It goes in a random fence and the model is told it is data; then every answer is checked
here as well: only the fields asked for, short plain strings, and an email address or phone number is kept only when it
really appears in the email, so an invented or injected contact detail never becomes a contact. Prompt building and the
checks are pure; extract() makes the one call."""

from __future__ import annotations

import re
from typing import Any

from ..gemini import Gemini
from ..gemini_types import UsageContext
from ..text import UNTRUSTED, fenced, new_fence
from .labelled import EMAIL_RE, MAX_VALUE
from .phone import normalise_phone

MAX_BODY = 6000  # characters of the email sent; an enquiry is short and the rest is footer
MAX_OUTPUT = 700  # tokens: a handful of short fields
DEFAULT_MAX = 300  # characters kept of a field with no limit of its own

SYSTEM = (
    "You read one email and fill in the fields listed, copying only what the email says. If a field is not in the email, "
    "return an empty string for it. Never guess, never invent a name, address or number, and never use the sender's own "
    "address or a company's address as the person's: the person is the one who wrote to the user or made the enquiry. "
    "Copy numbers and names exactly as written."
) + UNTRUSTED


def schema(fields: tuple[tuple[str, str], ...]) -> dict[str, Any]:
    """The answer schema: one string for each field, all required, with the field's description."""
    return {
        "type": "object",
        "properties": {key: {"type": "string", "description": description or key} for key, description in fields},
        "required": [key for key, _ in fields],
    }


def prompt(fields: tuple[tuple[str, str], ...], sender: str | None, subject: str | None, body: str, fence: str | None = None) -> str:
    """The user turn: the fields wanted, then the email inside the fence."""
    wanted = "\n".join(f"- {key}: {description}" for key, description in fields)
    mail = f"From: {sender or 'unknown'}\nSubject: {subject or '(none)'}\n\n{body[:MAX_BODY]}"
    return f"Fields to fill in:\n{wanted}\n\nEmail:\n{fenced(mail, fence or new_fence())}"


def check(raw: Any, fields: tuple[tuple[str, str], ...], mail: str) -> dict[str, str] | None:
    """The model's answer reduced to what can be trusted, or None when nothing usable is left. mail is the text the model saw."""
    if not isinstance(raw, dict):
        return None
    low = mail.lower()
    digits = re.sub(r"\D", "", mail)
    out: dict[str, str] = {}
    for key, _ in fields:
        value = " ".join(str(raw.get(key) or "").split())[: MAX_VALUE.get(key, DEFAULT_MAX)]
        if not value:
            continue
        if key == "email" or EMAIL_RE.fullmatch(value):
            found = EMAIL_RE.search(value)
            if not found or found.group(0).lower() not in low:
                continue  # an address the email never contained
            value = found.group(0).lower()
        elif key == "phone":
            phone = normalise_phone(value)
            if not phone or phone[-9:] not in digits:
                continue
            value = phone
        out[key] = value
    return out or None


def extract(gemini: Gemini, model: str, usage: UsageContext, fields: tuple[tuple[str, str], ...], sender: str | None, subject: str | None, body: str) -> dict[str, str] | None:
    """One structured call. Raises GeminiError (including a used up share), which the engine records on the run."""
    mail = f"{sender or ''}\n{subject or ''}\n{body[:MAX_BODY]}"
    raw = gemini.json(model, SYSTEM, prompt(fields, sender, subject, body), schema(fields), usage, temperature=0.0, thinking="minimal", max_output=MAX_OUTPUT, attempts=2, timeout=45)
    return check(raw, fields, mail)
