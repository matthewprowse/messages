"""The pure half of Readable Bulk Email (bulk_read.py does the I/O): which links of a newsletter or marketing email
are worth offering, the prompt and schema for the model, and the checks that decide whether its answer is used.

The model never writes a link or a figure the email did not contain. Links are chosen by number from the list built
here, and a point or summary is dropped when a number in it is not in the email. Output is plain text only."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlsplit

from .text import UNTRUSTED, clean, fenced, html_to_text, new_fence

BODY_CHARS = 3000  # about 750 tokens: enough for the offer, dates and prices of a marketing email
MAX_OFFERED = 12  # links shown to the model
MAX_LINKS = 4
MAX_POINTS = 5
SUMMARY_CHARS = 160
POINT_CHARS = 120
LABEL_CHARS = 40
CONTEXT_CHARS = 80

URL_RE = re.compile(r"https?://[^\s<>()\[\]\"']+")
# Links nobody reads a newsletter for: leaving, settings, legal, social and "view in browser".
SKIP_LINK = re.compile(
    r"unsubscribe|opt[-_ ]?out|preferences?|manage[-_ ]?(?:your|email|subscription)|privacy|terms|legal|view[-_ ]?(?:in|this)[-_ ]?(?:your )?browser|"
    r"facebook\.com|twitter\.com|x\.com|instagram\.com|linkedin\.com|youtube\.com|tiktok\.com|pinterest\.com|whatsapp\.com",
    re.I,
)
DASHES = re.compile(r"\s*[—–]\s*")
RANGE = re.compile(r"(?<=\d)\s*[—–]\s*(?=\d)")

SYSTEM = """You turn one marketing, newsletter or notification email into a short readable version for the person it was sent to. They will read your version instead of the email's own layout, so it must be accurate and plain.

summary: one sentence saying what the email is and what, if anything, it wants from them. Plain words, not the sender's selling language.

points: up to 5 short facts worth knowing, each one line: the offer, dates and deadlines, prices, what changed, what is being asked. Only what the email says. Never add, guess, round or convert a figure, date or name. Fewer points is fine; an email with nothing in it has none.

links: up to 4 of the numbered links you are given that the person might actually want, as {label, id}. The label says what the link does in 1 to 4 words in Title Case, such as "View the Sale", "Track Your Order" or "Read the Article". Use the number exactly as given and never write an address. Leave out links you are unsure about.

If the email is mostly images or says almost nothing, say so in the summary and return no points and no links.

Write in British English. Do not use dashes. Do not repeat the subject as the summary.""" + UNTRUSTED

SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "points": {"type": "array", "items": {"type": "string"}},
        "links": {
            "type": "array",
            "items": {"type": "object", "properties": {"label": {"type": "string"}, "id": {"type": "integer"}}, "required": ["label", "id"]},
        },
    },
    "required": ["summary", "points", "links"],
}


def extract_links(text: str) -> list[dict[str, str]]:
    """The email's real links, in order, without repeats: {url, context, host}. context is the words around the link
    (its own line, or the line above when the link stands alone). Unsubscribe, settings, legal, social and
    view-in-browser links are left out here, so the model is never asked about them."""
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    lines = text.replace("\r\n", "\n").split("\n")
    previous = ""
    for line in lines:
        found = [m.group(0).rstrip(".,;:!?)") for m in URL_RE.finditer(line)]
        words = " ".join(URL_RE.sub(" ", line).replace("(", " ").replace(")", " ").replace("[", " ").replace("]", " ").split())
        for url in found:
            host = (urlsplit(url).hostname or "").lower()
            context = (words or previous)[:CONTEXT_CHARS]
            if not host or url in seen or SKIP_LINK.search(url) or SKIP_LINK.search(context):
                continue
            seen.add(url)
            out.append({"url": url, "context": context, "host": host})
        if words:
            previous = words
        if len(out) >= MAX_OFFERED:
            break
    return out[:MAX_OFFERED]


def readable_text(text: str | None, html_body: str | None = None, limit: int = BODY_CHARS) -> str:
    """The email's words for the model: quoted history and footers cut as for triage, and web addresses removed
    (they are offered separately, by number)."""
    body = clean(text, html_body, limit=limit * 2)
    body = re.sub(r"\(\s*https?://[^\s)]*\s*\)", "", body)
    body = URL_RE.sub("", body).replace("[link]", "")
    body = re.sub(r"[ \t]+", " ", body)
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    return body[:limit].rsplit(" ", 1)[0] + " ..." if len(body) > limit else body


def prompt(sender: str, subject: str, body: str, links: list[dict[str, str]], fence: str | None = None) -> str:
    """The email, its links by number and who sent it, inside a random fence so its own text cannot pass for instructions."""
    shown = "\n".join(f"{i}. {l['context'] or '(no words)'} [{l['host']}]" for i, l in enumerate(links, 1)) or "(none)"
    return fenced(f"From: {sender or 'unknown'}\nSubject: {subject or '(none)'}\n\nLinks you may use:\n{shown}\n\nEmail:\n{body}", fence or new_fence())


def plain(value: Any, limit: int) -> str:
    """One line of plain text: no dashes (the app writes none), tidy spaces, at most `limit` characters."""
    text = DASHES.sub(", ", RANGE.sub(" to ", str(value or ""))).replace("—", ",").replace("–", ",")
    return " ".join(text.split())[:limit].strip(" ,")


NUMBER_RE = re.compile(r"\d{1,3}(?: \d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)*")


def normal_number(token: str) -> str:
    """One written number as a plain canonical string, so "R1,299.50", "1 299,50" and "1299.5" are the same figure:
    a separator followed by exactly three digits (and not the only one after a lone digit group) is thousands,
    the last separator otherwise is the decimal point."""
    t = token.replace(" ", "")
    marks = [c for c in t if c in ",."]
    if len(set(marks)) == 2:  # both: the later one is the decimal point
        point = max(t.rfind(","), t.rfind("."))
        t = t[:point].replace(",", "").replace(".", "") + "." + t[point + 1 :]
    elif marks:
        sep = marks[0]
        head, _, tail = t.partition(sep)
        if len(marks) > 1 or (len(tail) == 3 and 1 <= len(head) <= 3 and head != "0"):
            t = t.replace(sep, "")  # thousands
        else:
            t = t.replace(sep, ".")
    whole, _, frac = t.partition(".")
    frac = frac.rstrip("0")
    return (whole.lstrip("0") or "0") + ("." + frac if frac else "")


def figures(value: str) -> list[str]:
    """The numbers written in value, each normalised (see normal_number)."""
    return [normal_number(m) for m in NUMBER_RE.findall(value)]


def number_set(text: str) -> set[str]:
    """Every number that appears in text as its own token, normalised. A space-grouped number ("1 299") also counts
    as its parts, since the email may have been split there."""
    found: set[str] = set()
    for m in NUMBER_RE.findall(text):
        found.add(normal_number(m))
        if " " in m:
            found.update(normal_number(p) for p in m.split())
    return found


def grounded(value: str, source: str | set[str]) -> bool:
    """Every number in value is a number the email itself contains (as a whole token, not a run of digits inside
    others), so an invented price or date fails. source is the email's text or its number_set."""
    have = number_set(source) if isinstance(source, str) else source
    return all(f in have for f in figures(value))


def html_text(html_body: str | None) -> str:
    """The words of an HTML-only email, with each link's address written after its words so extract_links and the
    figure check see what a text part would have had."""
    if not html_body:
        return ""
    linked = re.sub(r"<a\s[^>]*?href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", r" \2 \1 ", html_body, flags=re.S | re.I)
    return html_to_text(linked)


def check_answer(text: str, links: list[dict[str, str]], answer: Any) -> dict[str, Any] | None:
    """The model's answer as the readable version to store, or None when it cannot be used: no summary, or a
    summary with a figure the email lacks. Points with an unsupported figure are dropped, links must be numbers
    from `links`, and everything is plain, short text."""
    if not isinstance(answer, dict):
        return None
    source_digits = number_set(text)
    summary = plain(answer.get("summary"), SUMMARY_CHARS)
    if not summary or not grounded(summary, source_digits):
        return None
    points: list[str] = []
    for raw in answer.get("points") if isinstance(answer.get("points"), list) else []:
        point = plain(raw, POINT_CHARS)
        if point and len(str(raw)) <= POINT_CHARS * 2 and grounded(point, source_digits) and point.lower() not in {p.lower() for p in points}:
            points.append(point)
    chosen: list[dict[str, str]] = []
    used: set[int] = set()
    for item in answer.get("links") if isinstance(answer.get("links"), list) else []:
        if not isinstance(item, dict) or isinstance(item.get("id"), bool) or not isinstance(item.get("id"), int):
            continue
        n, label = item["id"], plain(item.get("label"), LABEL_CHARS)
        if 1 <= n <= len(links) and n not in used and label:
            used.add(n)
            chosen.append({"label": label, "url": links[n - 1]["url"]})
    return {"summary": summary, "points": points[:MAX_POINTS], "links": chosen[:MAX_LINKS]}
