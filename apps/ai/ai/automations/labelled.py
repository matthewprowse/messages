"""Reads the labelled fields of a portal enquiry email ("Name: ...", "Contact Number: ...", "Message: ...") out of its plain
or HTML body. The fixed parser behind the Property24 and Private Property templates: free, exact, and deliberately strict.
When it cannot find a name and a way to reach the person it returns None, and the engine falls back to Gemini.

Portals vary their labels and lay them out as lines ("Name: Sipho"), as table cells ("Name" then "Sipho") or label above
value, so the reader accepts all three. It never trusts the text: nothing here is run or sent anywhere, and a value is
checked and cut to length before anything uses it. Pure: no network, no database."""

from __future__ import annotations

import html
import re
from urllib.parse import urlparse

from .phone import find_phone, normalise_phone

MAX_TEXT = 60_000  # characters read from a body; an enquiry is a few hundred
MAX_VALUE = {"name": 80, "email": 120, "phone": 30, "message": 1000, "listing_ref": 40, "listing_url": 300, "listing": 160, "price": 40}

# Label variants by field, merged with a template's own. Matched whole, case-insensitively, then followed by a colon, a tab
# (a table cell), a spaced hyphen, two or more spaces, or the end of the line.
LABELS: dict[str, list[str]] = {
    "name": ["full name", "contact name", "enquirer name", "enquirer", "customer name", "lead name", "your name", "name"],
    "email": ["email address", "e-mail address", "contact email", "email", "e-mail"],
    "phone": [
        "contact number", "phone number", "telephone number", "cellphone number", "cell number", "mobile number", "contact telephone",
        "contact tel", "contact no", "telephone", "cellphone", "mobile", "phone", "cell", "tel",
    ],
    "message": ["your message", "message", "comments", "comment", "enquiry", "inquiry", "question", "additional information"],
    "listing_ref": [
        "listing number", "listing id", "listing reference", "property reference", "property number", "property ref", "web reference",
        "web ref", "p24 reference", "reference number", "reference", "ref no", "ref",
    ],
    "listing": ["property address", "listing address", "property title", "property", "listing", "address"],
    "price": ["asking price", "listing price", "price"],
}

# Lines that end a free-text message: a sign-off, a footer, a button.
_FOOTER = re.compile(
    r"^(?:kind regards|regards|best regards|thank you|thanks|this (?:e-?mail|message)|you (?:are receiving|received)|to unsubscribe|unsubscribe|"
    r"please (?:do not|don't) reply|do not reply|sent (?:via|from|by)|powered by|copyright|©|view (?:the )?(?:listing|property|enquiry)|reply (?:to|directly)|"
    r"log in|manage your|privacy policy|terms and conditions)\b",
    re.I,
)
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+")
URL_RE = re.compile(r"https?://[^\s<>\"')\]]+", re.I)
HREF_RE = re.compile(r"href\s*=\s*[\"']([^\"']+)[\"']", re.I)
# A portal's own addresses, never the lead's: no-reply, the lead service and the like.
_PORTAL_LOCAL = re.compile(r"^(?:no-?reply|do-?not-?reply|noreply|leads?|enquiries|support|info|mailer|notifications?|alerts?)\b", re.I)


def html_text(value: str) -> str:
    """HTML as lines of text, keeping table cells apart with a tab so "Name" and "Sipho" stay a label and its value."""
    value = re.sub(r"<(style|script|head)[^>]*>.*?</\1>", " ", value, flags=re.S | re.I)
    value = re.sub(r"<br\s*/?>", "\n", value, flags=re.I)
    value = re.sub(r"</t[dh]\s*>", "\t", value, flags=re.I)
    value = re.sub(r"</(p|div|tr|li|h[1-6]|table|section)\s*>", "\n", value, flags=re.I)
    value = re.sub(r"<[^>]+>", "", value)
    return html.unescape(value)


def to_text(body_text: str | None, body_html: str | None) -> tuple[str, list[str]]:
    """The body as plain lines and every link in it. The plain part wins when there is one, since it has the portal's own
    line breaks; the HTML supplies the text when there is none and always supplies the hrefs."""
    plain = (body_text or "").strip()
    text = plain or html_text(body_html or "")
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\xa0", " ")[:MAX_TEXT]
    links = [html.unescape(u) for u in HREF_RE.findall(body_html or "")] + URL_RE.findall(text)
    seen: dict[str, None] = {}
    for link in links:
        seen.setdefault(link.rstrip(".,;)"), None)
    return text, list(seen)


def _compiled(labels: dict[str, list[str]]) -> list[tuple[str, int, re.Pattern[str]]]:
    out = []
    for key, names in labels.items():
        for name in sorted(set(names), key=len, reverse=True):
            pattern = r"^\s*" + re.escape(name).replace(r"\ ", r"\s+") + r"\s*(?:[:：]|\t|\s-\s|\s{2,}|$)\s*(.*)$"
            out.append((key, len(name), re.compile(pattern, re.I)))
    return out


def _label_of(line: str, compiled: list[tuple[str, int, re.Pattern[str]]]) -> tuple[str, str] | None:
    """(field, value on the same line) when the line starts with a known label; the longest label wins."""
    best: tuple[int, str, str] | None = None
    for key, size, pattern in compiled:
        m = pattern.match(line)
        if m and (best is None or size > best[0]):
            best = (size, key, m.group(1))
    return (best[1], best[2]) if best else None


def read_labelled(text: str, extra: dict[str, list[str]] | None = None) -> dict[str, str]:
    """The first value found for each field, raw (not yet checked). Message values run over several lines until a label or a footer."""
    labels = {k: list(v) for k, v in LABELS.items()}
    for key, names in (extra or {}).items():
        labels.setdefault(key, []).extend(names)
    compiled = _compiled(labels)
    lines = [ln.rstrip() for ln in text.split("\n")]
    found: dict[str, str] = {}
    i = 0
    while i < len(lines):
        hit = _label_of(lines[i], compiled)
        i += 1
        if not hit or hit[0] in found:
            continue
        key, value = hit[0], hit[1].replace("\t", " ").strip()
        if not value:  # the value is on the next line (table cell or label above value)
            j = i
            while j < len(lines) and not lines[j].strip():
                j += 1
            if j < len(lines) and not _label_of(lines[j], compiled) and not _FOOTER.match(lines[j].strip()):
                value = lines[j].replace("\t", " ").strip()
                i = j + 1
        if key == "message":
            parts = [value] if value else []
            while i < len(lines):
                line = lines[i].strip()
                if line and (_label_of(lines[i], compiled) or _FOOTER.match(line)):
                    break
                if line:
                    parts.append(line.replace("\t", " "))
                i += 1
                if sum(len(p) for p in parts) > MAX_VALUE["message"]:
                    break
            value = "\n".join(parts)
        if value:
            found[key] = value
    return found


def _portal_address(address: str, hosts: tuple[str, ...], own: set[str]) -> bool:
    """Whether an address is the portal's or the user's own, so it is never taken as the lead's."""
    local, _, domain = address.lower().partition("@")
    return address.lower() in own or any(domain == h or domain.endswith("." + h) for h in hosts) or bool(_PORTAL_LOCAL.match(local))


def _clean_name(value: str | None) -> str | None:
    name = re.sub(r"\s+", " ", (value or "")).strip(" \t:-,")
    if not name or "@" in name or not re.search(r"[^\W\d_]", name) or len(re.findall(r"\d", name)) > 3 or URL_RE.search(name):
        return None
    return name[: MAX_VALUE["name"]]


def _listing_url(links: list[str], hosts: tuple[str, ...]) -> str | None:
    """The first link to the portal that points at a listing (a path with a number in it), not the portal's home or footer."""
    for link in links:
        parsed = urlparse(link)
        host = (parsed.hostname or "").lower()
        if any(host == h or host.endswith("." + h) for h in hosts) and re.search(r"\d{5,}", parsed.path):
            return link[: MAX_VALUE["listing_url"]]
    return None


def parse_enquiry(text: str, links: list[str], *, hosts: tuple[str, ...], own: set[str] | None = None, labels: dict[str, list[str]] | None = None) -> dict[str, str] | None:
    """The enquiry's fields, or None when this does not look like one (no name, or no email or phone to reach them).

    hosts are the portal's domains: its addresses and links are told apart from the lead's. own is the user's own
    addresses (lowercase), which are never the lead."""
    own = {a.lower() for a in (own or set())}
    raw = read_labelled(text, labels)
    out: dict[str, str] = {}
    name = _clean_name(raw.get("name"))
    email = next((e for e in EMAIL_RE.findall(raw.get("email", "")) if not _portal_address(e, hosts, own)), None)
    if email is None:  # an address written without its label: any address that is not the portal's or the user's
        email = next((e for e in EMAIL_RE.findall(text) if not _portal_address(e, hosts, own)), None)
    phone = normalise_phone(raw.get("phone")) or find_phone(raw.get("phone"))
    if not name or not (email or phone):
        return None
    out["name"] = name
    if email:
        out["email"] = email.lower()[: MAX_VALUE["email"]]
    if phone:
        out["phone"] = phone
    message = re.sub(r"[ \t]+", " ", raw.get("message", "")).strip()
    if message:
        out["message"] = message[: MAX_VALUE["message"]]
    url = _listing_url(links, hosts)
    if url:
        out["listing_url"] = url
    ref = re.sub(r"\s+", " ", raw.get("listing_ref", "")).strip(" :.")
    if not ref and url:
        tail = re.search(r"(\d{6,})(?:[/?#]|$)", urlparse(url).path)
        ref = tail.group(1) if tail else ""
    if ref and len(ref) <= MAX_VALUE["listing_ref"]:
        out["listing_ref"] = ref
    for key in ("listing", "price"):
        value = re.sub(r"\s+", " ", raw.get(key, "")).strip()
        if value:
            out[key] = value[: MAX_VALUE[key]]
    return out
