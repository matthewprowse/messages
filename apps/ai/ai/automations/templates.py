"""The templates and how to Read them: which fixed parser belongs to which template key, and the fields Gemini is asked for when a
template's parser cannot read an email. Adding a template is a parser module, a line here, and its card in the web gallery
(apps/web/lib/automations-templates.ts). Pure."""

from __future__ import annotations

from typing import Callable

from . import private_property, property24

Parser = Callable[[str, "list[str]", "set[str] | None"], "dict[str, str] | None"]

PARSERS: dict[str, Parser] = {property24.KEY: property24.parse, private_property.KEY: private_property.parse}
SOURCES = {property24.KEY: property24.NAME, private_property.KEY: private_property.NAME}

# What a template asks Gemini for when its parser fails: the same fields the parsers produce.
TEMPLATE_FIELDS: tuple[tuple[str, str], ...] = (
    ("name", "The full name of the person who made the enquiry. Never the portal or the agent."),
    ("email", "The enquirer's own email address, not the portal's and not the agent's. Empty if not written."),
    ("phone", "The enquirer's own phone number as written. Empty if not written."),
    ("message", "What the enquirer wrote or asked, in their words, shortened if long."),
    ("listing_ref", "The listing or property reference number the enquiry is about."),
    ("listing", "The property's address or title."),
    ("price", "The asking price if shown."),
)


def parser_for(template_key: str | None) -> Parser | None:
    """The fixed parser for a template, or None for a custom automation (which always asks Gemini)."""
    return PARSERS.get(template_key or "")
