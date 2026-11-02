"""The Property24 Enquiry template: the fixed parser for the email Property24 sends an agent when someone enquires about a listing.

Built from the publicly known layout (labelled Name, Email, Phone or Contact Number, Message, Listing Number and a link to the
listing), not from real emails: the owner must test it against real enquiries, read only, before turning it on. Anything it
cannot read returns None and the engine asks Gemini instead."""

from __future__ import annotations

from .labelled import parse_enquiry

KEY = "property24"
NAME = "Property24 Enquiry"
SOURCE = "Property24"
HOSTS = ("property24.com",)
# Property24's own wording for its listing number, on top of the shared labels.
LABELS = {"listing_ref": ["p24 listing number", "property24 listing number", "listing no"], "phone": ["telephone no", "cell no"]}


def parse(text: str, links: list[str], own: set[str] | None = None) -> dict[str, str] | None:
    """The enquiry's name, email, phone, message and listing from a Property24 enquiry body, or None."""
    return parse_enquiry(text, links, hosts=HOSTS, own=own, labels=LABELS)
