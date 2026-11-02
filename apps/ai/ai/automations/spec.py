"""An automation's setup as the AI worker reads it: When (conditions), Read (the fields to pull out) and Do (what to make of them).

The sealed JSON in automations.spec is checked here before anything runs: every list and text is capped, unknown keys are
dropped, and an automation with no condition at all is refused (it would match every email). The web app writes the same shape
(apps/web/lib/automations.ts). Pure."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

MAX_LIST = 20  # entries in one condition list
MAX_TEXT = 120  # characters in a condition, a field key or a task title
MAX_FIELDS = 12  # fields a custom automation may ask Gemini for
MAX_DESCRIPTION = 200
MAX_TASK_MINUTES = 7 * 24 * 60
KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,31}$")


@dataclass(frozen=True)
class When:
    """Conditions on a new email. Every non-empty group must hold; within a group any one entry is enough."""

    senders: tuple[str, ...] = ()  # an address (has @) or a domain
    subject: tuple[str, ...] = ()  # words or phrases the subject contains
    body: tuple[str, ...] = ()  # words or phrases the body contains
    anywhere: tuple[str, ...] = ()  # words or phrases in the subject or the body
    accounts: tuple[str, ...] = ()  # email account ids; empty means every email account

    def has_condition(self) -> bool:
        return bool(self.senders or self.subject or self.body or self.anywhere)


@dataclass(frozen=True)
class Do:
    contact: bool = True  # create or update the contact
    lead: bool = True  # mark them a Lead with the source
    source: str = ""  # shown on the contact, such as "Property24 Enquiry"
    link: bool = True  # put the conversation on their timeline
    task_title: str | None = None  # None means no task
    task_minutes: int = 5  # due this many minutes after the email arrived
    draft: bool = False  # write a reply draft to the lead's own address
    urgent: bool = False  # mark the conversation urgent so the existing push goes out


@dataclass(frozen=True)
class Spec:
    name: str
    when: When
    fields: tuple[tuple[str, str], ...] = ()  # (key, one-line description) for Gemini; a template's parser ignores it
    do: Do = field(default_factory=Do)


def _texts(raw: Any, lower: bool = True) -> tuple[str, ...]:
    if not isinstance(raw, list):
        return ()
    out: list[str] = []
    for v in raw[:MAX_LIST]:
        text = " ".join(str(v).split())[:MAX_TEXT].strip() if isinstance(v, (str, int)) else ""
        if text and text.lower() not in (o.lower() for o in out):
            out.append(text.lower() if lower else text)
    return tuple(out)


def parse_spec(raw: Any) -> Spec | None:
    """The checked spec from a decoded JSON object, or None when it cannot run (not an object, no name, no condition)."""
    if not isinstance(raw, dict):
        return None
    name = " ".join(str(raw.get("name") or "").split())[:MAX_TEXT]
    w = raw.get("when") if isinstance(raw.get("when"), dict) else {}
    when = When(
        senders=_texts(w.get("senders")), subject=_texts(w.get("subject")), body=_texts(w.get("body")), anywhere=_texts(w.get("anywhere")),
        accounts=tuple(a for a in _texts(w.get("accounts"), lower=False) if re.fullmatch(r"[0-9a-fA-F-]{36}", a)),
    )
    if not name or not when.has_condition():
        return None
    fields: list[tuple[str, str]] = []
    r = raw.get("read") if isinstance(raw.get("read"), dict) else {}
    for f in (r.get("fields") if isinstance(r.get("fields"), list) else [])[:MAX_FIELDS]:
        if isinstance(f, dict) and isinstance(f.get("key"), str) and KEY_RE.match(f["key"]) and f["key"] not in dict(fields):
            fields.append((f["key"], " ".join(str(f.get("description") or "").split())[:MAX_DESCRIPTION]))
    d = raw.get("do") if isinstance(raw.get("do"), dict) else {}
    task = d.get("task") if isinstance(d.get("task"), dict) else None
    title = " ".join(str(task.get("title") or "").split())[:MAX_TEXT] if task else ""
    minutes = task.get("minutes") if task else 5
    return Spec(
        name=name, when=when, fields=tuple(fields),
        do=Do(
            contact=d.get("contact") is not False, lead=d.get("lead") is not False,
            source=" ".join(str(d.get("source") or "").split())[:MAX_TEXT] or name, link=d.get("link") is not False,
            task_title=title or None, task_minutes=minutes if isinstance(minutes, int) and not isinstance(minutes, bool) and 0 <= minutes <= MAX_TASK_MINUTES else 5,
            draft=d.get("draft") is True, urgent=d.get("urgent") is True,
        ),
    )


def load_spec(text: str | None) -> Spec | None:
    """parse_spec of sealed-then-opened JSON text; None for text that is not JSON."""
    try:
        return parse_spec(json.loads(text or ""))
    except ValueError:
        return None
