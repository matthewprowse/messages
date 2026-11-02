"""The Private Property Enquiry template: the fixed parser for the email Private Property sends an agent when someone enquires
about a listing.

Built from the publicly known layout (labelled Name, Email, Phone or Contact Number, Message, a property reference and a link),
not from real emails: the owner must test it against real enquiries, read only, before turning it on. Anything it cannot read
returns None and the engine asks Gemini instead."""

from __future__ import annotations

from .labelled import parse_enquiry

KEY = "private_property"
NAME = "Private Property Enquiry"
SOURCE = "Private Property"
HOSTS = ("privateproperty.co.za",)
# Private Property calls the listing number a web reference or a property reference.
LABELS = {"listing_ref": ["pp reference", "private property reference", "pp ref"], "phone": ["contact telephone number", "phone no"]}


def parse(text: str, links: list[str], own: set[str] | None = None) -> dict[str, str] | None:
    """The enquiry's name, email, phone, message and listing from a Private Property enquiry body, or None."""
    return parse_enquiry(text, links, hosts=HOSTS, own=own, labels=LABELS)
