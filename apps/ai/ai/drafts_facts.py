"""The fact guard: after a draft is written, every number, amount, date, time, phone number, email address and web
address in it must appear in what the draft was written from (the conversation, the instruction and decision, the
saved facts and notes, the calendar). The ones that do not are listed so the app can show "Check This" next to
them, and one retry is made at a lower temperature. Placeholders such as [Name], {x} or TODO are found too.

Deterministic and pure: no model, no network, no database. A miss is a prompt to look, never a block: the person
reads the draft and decides. Matching is by a normal form (R 4 500 and R4,500 are the same amount, 2pm and 14:00
the same time), and a date only counts as found when the same day and month are in the context, so "Friday" in a
draft needs "Friday" (or a calendar event on a Friday) somewhere in what the model was given.

The newest messages from the other side (and the one-tap decision worded from them) are their text, not evidence. A
detail that is risky to repeat (an amount, an account or long number, a phone number, an email or web address) and is
found only there is reported as not found and "echoed": the chips ask the person to check it, no retry is made (it is
in the conversation, so asking again would only drop it), and a pre-draft carrying one is held for review."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

RETRY_TEMPERATURE = 0.2  # the draft's first temperature is higher; a report with problems asks again at this
CALENDAR_DAYS = 14  # how far ahead the calendar is shown to the check
MAX_FACTS = 24  # a long draft lists no more than this, so the chips stay readable
DEFAULT_ZONE = "Africa/Johannesburg"

MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3, "apr": 4, "april": 4, "may": 5, "jun": 6, "june": 6,
    "jul": 7, "july": 7, "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9, "oct": 10, "october": 10, "nov": 11,
    "november": 11, "dec": 12, "december": 12,
}
WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
_MONTH = r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"

IBAN = re.compile(r"\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?\b")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
URL = re.compile(r"(?:https?://|www\.)[^\s<>\"']+", re.I)
PHONE = re.compile(r"(?<![\w.])\+?\d[\d ()\-]{7,}\d(?!\w)")
ISO_DATE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
DAY_MONTH = re.compile(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?({_MONTH})\b(?:\s+\d{{4}})?", re.I)
MONTH_DAY = re.compile(rf"\b({_MONTH})\s+(\d{{1,2}})(?:st|nd|rd|th)?\b", re.I)
SLASH_DATE = re.compile(r"\b(\d{1,2})/(\d{1,2})(?:/\d{2,4})?\b")
WEEKDAY = re.compile(r"\b(" + "|".join(WEEKDAYS) + r")s?\b", re.I)
CLOCK = re.compile(r"\b(\d{1,2})[:h](\d{2})\s*(am|pm)?(?!\d)", re.I)
CLOCK_DOT = re.compile(r"\b(\d{1,2})\.(\d{2})\s*(am|pm)\b", re.I)
HOUR = re.compile(r"\b(\d{1,2})\s?(am|pm)\b", re.I)
AMOUNT = re.compile(r"(?:R|ZAR|USD|EUR|GBP|[$€£])\s?\d{1,3}(?:[ ,]\d{3})+(?:[.,]\d{1,2})?|(?:R|ZAR|USD|EUR|GBP|[$€£])\s?\d+(?:[.,]\d{1,2})?", re.I)
NUMBER = re.compile(r"(?<![\w.])\d{1,3}(?:[ ,]\d{3})+(?:\.\d+)?(?![\w])|(?<![\w.])\d+(?:\.\d+)?%?(?![\w])")
PLACEHOLDERS = (
    re.compile(r"\[[^\]\n]{1,40}\]"),
    re.compile(r"\{\{?[^}\n]{1,40}\}?\}"),
    re.compile(r"<[A-Za-z][A-Za-z _]{1,30}>"),
    re.compile(r"\b(?:TODO|TBD|FIXME|XXX+)\b"),
    re.compile(r"_{3,}"),
)
_DIGITS_ONLY = re.compile(r"^\[\s*\d+\s*\]$")


HIGH_RISK = {"amount", "account", "phone", "email", "url"}  # what a payment redirect or phishing reply would repeat
LONG_NUMBER = 8  # digits: a plain number this long reads as an account or reference number


@dataclass
class Fact:
    kind: str  # amount, number, account, date, weekday, time, phone, email, url
    text: str  # as written in the draft
    keys: tuple[str, ...]  # normal forms; found when any is in the context
    found: bool = False


def _number_key(raw: str) -> str:
    """4 500, 4,500 and 4500.00 are all 4500; 4500,50 (a decimal comma) is 4500.5."""
    s = re.sub(r"[^\d.,]", "", raw)
    if re.search(r",\d{1,2}$", s) and "." not in s:
        s = s.replace(",", ".")
    s = s.replace(",", "")
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return "n:" + (s.lstrip("0") or "0")


def _url_key(raw: str) -> str:
    s = raw.lower().rstrip(".,;:!?)")
    s = re.sub(r"^https?://", "", s)
    s = re.sub(r"^www\.", "", s)
    return "url:" + s.rstrip("/")


def _time_key(hour: int, minute: int, meridiem: str | None) -> str | None:
    m = (meridiem or "").lower()
    if m and not 1 <= hour <= 12:
        return None
    if m == "pm" and hour != 12:
        hour += 12
    if m == "am" and hour == 12:
        hour = 0
    return f"time:{hour:02d}:{minute:02d}" if hour <= 23 and minute <= 59 else None


def _blank(text: str, span: tuple[int, int]) -> str:
    return text[: span[0]] + " " * (span[1] - span[0]) + text[span[1] :]


def extract(text: str) -> list[Fact]:
    """The checkable details in text, in the order found. A span read as one kind is blanked, so a phone number
    is not also read as numbers, and a date is not also read as a day number and an amount."""
    facts: list[Fact] = []
    work = text or ""

    def take(pattern: re.Pattern[str], make: Any) -> None:
        nonlocal work
        for m in list(pattern.finditer(work)):
            made = make(m)
            if made is None:
                continue
            facts.append(made)
            work = _blank(work, m.span())

    take(IBAN, lambda m: Fact("account", m.group(0), ("acct:" + m.group(0).replace(" ", "").upper(),)))
    take(EMAIL, lambda m: Fact("email", m.group(0), ("email:" + m.group(0).lower(),)))
    take(URL, lambda m: Fact("url", m.group(0).rstrip(".,;:!?)"), (_url_key(m.group(0)),)))
    take(PHONE, lambda m: Fact("phone", m.group(0).strip(), ("tel:" + re.sub(r"\D", "", m.group(0))[-9:],)) if 9 <= len(re.sub(r"\D", "", m.group(0))) <= 15 else None)
    take(ISO_DATE, lambda m: Fact("date", m.group(0), (f"date:{int(m.group(2)):02d}-{int(m.group(3)):02d}",)))
    take(DAY_MONTH, lambda m: Fact("date", m.group(0), (f"date:{MONTHS[m.group(2).lower()]:02d}-{int(m.group(1)):02d}",)) if 1 <= int(m.group(1)) <= 31 else None)
    take(MONTH_DAY, lambda m: Fact("date", m.group(0), (f"date:{MONTHS[m.group(1).lower()]:02d}-{int(m.group(2)):02d}",)) if 1 <= int(m.group(2)) <= 31 else None)
    # 3/11 is the 3rd of November here, but the 11th of March elsewhere: either reading in the context will do.
    take(SLASH_DATE, lambda m: Fact("date", m.group(0), (f"date:{int(m.group(2)):02d}-{int(m.group(1)):02d}", f"date:{int(m.group(1)):02d}-{int(m.group(2)):02d}")) if 1 <= int(m.group(1)) <= 31 and 1 <= int(m.group(2)) <= 31 else None)
    take(WEEKDAY, lambda m: Fact("weekday", m.group(0), ("day:" + m.group(1).lower(),)))

    def clock(m: re.Match[str]) -> Fact | None:
        key = _time_key(int(m.group(1)), int(m.group(2)), m.group(3))
        return Fact("time", m.group(0).strip(), (key,)) if key else None

    take(CLOCK_DOT, clock)
    take(CLOCK, clock)
    take(HOUR, lambda m: Fact("time", m.group(0), (k,)) if (k := _time_key(int(m.group(1)), 0, m.group(2))) else None)
    take(AMOUNT, lambda m: Fact("amount", m.group(0).strip(), (_number_key(m.group(0)),)))

    def number(m: re.Match[str]) -> Fact | None:
        raw = m.group(0)
        plain = re.sub(r"[ ,%]", "", raw)
        # Small whole numbers ("2 options", "point 1") say nothing a person needs warning about, and a year is
        # as likely to be a sign-off as a claim; both would only make the chips noisy.
        if "." not in plain and (int(plain) < 10 or 1990 <= int(plain) <= 2100):
            return None
        return Fact("number", raw, (_number_key(raw),))

    take(NUMBER, number)
    return facts


def placeholders(text: str) -> list[str]:
    """Text the model left for a person to fill in. Bracketed numbers (footnotes) are not placeholders."""
    found: list[str] = []
    for pattern in PLACEHOLDERS:
        for m in pattern.finditer(text or ""):
            hit = m.group(0)
            if _DIGITS_ONLY.match(hit) or "@" in hit or hit in found:
                continue
            found.append(hit)
    return found[:8]


def context_keys(texts: list[str]) -> set[str]:
    """Every normal form that appears in the texts the draft was written from."""
    keys: set[str] = set()
    for text in texts:
        for fact in extract(text or ""):
            keys.update(fact.keys)
        # A number small enough to be skipped when checking still counts as context for a figure like "R5".
        keys.update(_number_key(m.group(0)) for m in re.finditer(r"\d+(?:\.\d+)?", text or ""))
        keys.update("day:" + d for d in WEEKDAYS if re.search(rf"\b{d}s?\b", text or "", re.I))
    return keys


def high_risk(f: Fact) -> bool:
    """A detail a fraudster would want a reply to repeat: money, an account, a way to contact or pay someone."""
    return f.kind in HIGH_RISK or (f.kind == "number" and len(re.sub(r"\D", "", f.text)) >= LONG_NUMBER)


def check(draft: str, texts: list[str], untrusted: list[str] | None = None) -> dict[str, Any]:
    """The report for a draft: its checkable details with whether each is in the context, and its placeholders.
    texts are what the draft may rightly state; untrusted is the other side's newest text, which backs a low-risk
    detail (a day, a time) but never a high-risk one. {"facts": [{"kind", "text", "found", "echoed"?}],
    "placeholders": [...], "missing": n, "echoed": n, "review": n}: echoed counts high-risk details found only in
    untrusted, review every high-risk detail not found."""
    have = context_keys(texts)
    theirs = context_keys(untrusted or [])
    seen: set[str] = set()
    facts: list[dict[str, Any]] = []
    for f in extract(draft):
        if f.text.lower() in seen:
            continue
        seen.add(f.text.lower())
        found = any(k in have for k in f.keys)
        risky = high_risk(f)
        echoed = not found and risky and any(k in theirs for k in f.keys)
        found = found or (not risky and any(k in theirs for k in f.keys))
        facts.append({"kind": f.kind, "text": f.text[:60], "found": found, **({"echoed": True} if echoed else {}), **({"risky": True} if risky and not found else {})})
    facts = facts[:MAX_FACTS]
    holes = placeholders(draft)
    review = sum(1 for f in facts if f.pop("risky", False))
    return {
        "facts": facts,
        "placeholders": holes,
        "missing": sum(1 for f in facts if not f["found"]) + len(holes),
        "echoed": sum(1 for f in facts if f.get("echoed")),
        "review": review,
    }


def needs_retry(report: dict[str, Any]) -> bool:
    """True when something in the draft is in nothing it was written from, or a placeholder was left: ask again,
    colder. A detail echoed from the other side's message is in the conversation, so asking again would not help."""
    return int(report.get("missing") or 0) - int(report.get("echoed") or 0) > 0


def held_for_review(report: dict[str, Any] | None) -> bool:
    """True when the draft states a high-risk detail (an amount, account, phone, address or link) that nothing the
    person wrote or keeps supports: a pre-draft like this is stored but not put in front of them unasked."""
    return bool(report and report.get("review"))


def retry_note(report: dict[str, Any]) -> str:
    """Appended to the prompt for the second try. The details are the model's own earlier output, listed so it
    can leave them out; it is told to ask rather than guess. Details echoed from the conversation are not listed."""
    bad = [f["text"] for f in report.get("facts", []) if not f["found"] and not f.get("echoed")] + list(report.get("placeholders", []))
    return (
        "\nA first draft contained details that are not in the conversation, the instruction or the saved facts above: "
        + "; ".join(bad[:8])
        + ". Write the reply again without them. Use no placeholders. Where something is missing, leave it open or ask one short question."
    )


def calendar_lines(events: list[dict[str, Any]], zone_name: str | None = None, now: datetime | None = None) -> list[str]:
    """The next CALENDAR_DAYS of events as lines of text ("Thursday 5 November, 14:00 to 15:00"), in the person's
    time zone, so the check can match the days and times a draft mentions. Titles are never read."""
    try:
        zone = ZoneInfo(zone_name or DEFAULT_ZONE)
    except (ZoneInfoNotFoundError, ValueError):
        zone = ZoneInfo(DEFAULT_ZONE)
    start = now or datetime.now(timezone.utc)
    end = start + timedelta(days=CALENDAR_DAYS)
    lines: list[str] = []
    for e in events:
        try:
            a = datetime.fromisoformat(str(e["starts_at"]).replace("Z", "+00:00")).astimezone(zone)
            b = datetime.fromisoformat(str(e["ends_at"]).replace("Z", "+00:00")).astimezone(zone) if e.get("ends_at") else None
        except (KeyError, ValueError):
            continue
        if not start - timedelta(days=1) <= a.astimezone(timezone.utc) <= end:
            continue
        day = f"{a:%A} {a.day} {a:%B}"
        lines.append(day if e.get("all_day") else f"{day}, {a:%H:%M}" + (f" to {b:%H:%M}" if b else ""))
    return lines
