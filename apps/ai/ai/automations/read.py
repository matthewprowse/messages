"""Read: choose how an email's fields are read. A template's fixed parser first (free and exact); Gemini only when there is no
parser (a custom automation) or the parser could not read the email, and only for an email that looks worth asking about.
Pure: the engine owns the Gemini call and its daily cap, this decides whether to make it and for which fields."""

from __future__ import annotations

from .labelled import EMAIL_RE, to_text
from .phone import find_phone
from .spec import Spec
from .templates import TEMPLATE_FIELDS, parser_for


def prepare(body_text: str | None, body_html: str | None) -> tuple[str, list[str]]:
    """The body as text plus its links, for the parsers and for the prompt."""
    return to_text(body_text, body_html)


def parse_fixed(template_key: str | None, text: str, links: list[str], own: set[str] | None) -> dict[str, str] | None:
    """The template's parser result, or None when there is no parser for this key or it could not read the email."""
    parser = parser_for(template_key)
    return parser(text, links, own) if parser else None


def worth_asking(text: str, own: set[str] | None = None) -> bool:
    """Whether an email is worth a Gemini call: it holds a way to reach someone other than the user. A portal newsletter or a
    receipt for the user's own account has none, so it costs nothing."""
    mine = {a.lower() for a in own or set()}
    return any(e.lower() not in mine for e in EMAIL_RE.findall(text)) or find_phone(text) is not None


def fields_to_ask(spec: Spec, template_key: str | None) -> tuple[tuple[str, str], ...]:
    """What Gemini is asked for: the fixed set for a template, the user's own named fields for a custom automation."""
    return TEMPLATE_FIELDS if template_key else spec.fields


def with_name(fields: dict[str, str]) -> dict[str, str]:
    """The fields with a name always set, so a contact can be made: the address's first part, else the number, when Gemini found none."""
    if fields.get("name"):
        return fields
    stand_in = fields.get("email", "").partition("@")[0].replace(".", " ").replace("_", " ").title() or fields.get("phone", "")
    return {**fields, "name": stand_in} if stand_in else fields


def reachable(fields: dict[str, str]) -> bool:
    """Whether the fields give a way to know who this is: an address or a number. Without one no contact is made."""
    return bool(fields.get("email") or fields.get("phone"))
