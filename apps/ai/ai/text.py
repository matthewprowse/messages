"""Email text prepared for a prompt: the new writing only, without quoted history or footers."""

from __future__ import annotations

import html
import re

_CUTS = [
    re.compile(r"\n[ \t]*On [^\n]*(?:\n[^\n]*)?wrote:[ \t]*\n"),
    re.compile(r"\n[ \t]*-{2,}[ \t]*Original Message[ \t]*-{2,}", re.I),
    re.compile(r"\n[ \t]*From: [^\n]+\n[ \t]*(?:Sent|Date): "),
    re.compile(r"\n-- \n"),
    re.compile(r"\n[ \t]*_{10,}[ \t]*\n"),
    re.compile(r"\n[ \t]*(?:Get Outlook for|Sent from my|Sent from Outlook|Sent from Mail for) [^\n]*", re.I),
    re.compile(r"\n>[^\n]*"),
]


def html_to_text(value: str) -> str:
    value = re.sub(r"<(style|script|head)[^>]*>.*?</\1>", " ", value, flags=re.S | re.I)
    value = re.sub(r"<br\s*/?>", "\n", value, flags=re.I)
    value = re.sub(r"</(p|div|tr|li|h[1-6])>", "\n", value, flags=re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    return html.unescape(value)


def clean(text: str | None, html_body: str | None = None, limit: int = 2000) -> str:
    body = text or ""
    if not body.strip() and html_body:
        body = html_to_text(html_body)
    body = "\n" + body.replace("\r\n", "\n")
    for pattern in _CUTS:
        match = pattern.search(body)
        if match and match.start() > 0:
            body = body[: match.start()]
    body = re.sub(r"\[(?:https?://|cid:)[^\]]*\]", "", body)
    body = re.sub(r"https?://\S{60,}", "[link]", body)  # long tracking links say nothing useful
    body = re.sub(r"[ \t]+\n", "\n", body)
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    if len(body) > limit:
        body = body[:limit].rsplit(" ", 1)[0] + " ..."
    return body
