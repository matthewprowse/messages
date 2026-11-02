"""Action cards: a next step the draft call proposes (book a meeting, create a task, attach a file, use a template),
stored for the user to approve in the app. Nothing here acts: a proposal is a row in `actions` with sealed arguments,
and only a click in the web app does anything with it.

No extra model call: the reply draft already reads the conversation, so it may return one optional `action` object. The
model never picks people or files itself. It picks from short numbered lists this module builds from the user's own rows,
and every argument is checked here before a row is written. Meeting slots are not stored: the web app offers three free
times from the user's live calendar when the card is shown. Pure helpers first, then the small database reads and write."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any

from . import log
from .fields import ACTION, FILENAME
from .text import fenced, new_fence, plain_dashes

KINDS = ("book_meeting", "create_task", "attach_file", "use_template")
MAX_CANDIDATES = 8  # files and templates listed for the model; a short list keeps the prompt small and the pick easy
MAX_TITLE = 200
MINUTES = (15, 30, 45, 60, 90, 120)
DUE_WINDOW_DAYS = 365  # a due date further out than this is almost surely a misread

ACTION_PROPERTY = {
    "type": "object",
    "description": "One clear next step for the person you write for, or leave this out. Almost always leave it out.",
    "properties": {
        "kind": {"type": "string", "enum": list(KINDS)},
        "title": {"type": "string", "description": "book_meeting: the meeting's title. create_task: the task, as a short action."},
        "due": {"type": "string", "description": "create_task only: the due date as YYYY-MM-DD when the conversation names one, else empty."},
        "minutes": {"type": "integer", "description": "book_meeting only: how long, in minutes, when the conversation says; else 60."},
        "file": {"type": "integer", "description": "attach_file only: the number of the file in the list of files."},
        "template": {"type": "integer", "description": "use_template only: the number of the template in the list of templates."},
    },
    "required": ["kind"],
}

ACTION_SYSTEM = """

Next step (optional): when the conversation makes one next step clear, also return an `action`. Otherwise leave `action` out, which is the usual case.
- book_meeting: they ask to meet, call or find a time. Give a short title and the length in minutes only if they say it.
- create_task: the reply promises something the person must do later, or they were asked to. Give the task as a short action and a due date only if one is named.
- attach_file: they ask for a document that appears in the list of files. Give that file's number. Never for a file not listed.
- use_template: a template in the list fits this reply. Give its number.
- Never propose something just because it is possible. The reply text is the same whether or not you propose a step. Never invent a person, file, date or time."""


@dataclass
class Offer:
    """What the model may choose from for one draft: the user's own files and templates, in the order numbered in the prompt."""

    files: list[dict[str, Any]] = field(default_factory=list)  # {"id", "name"}
    templates: list[dict[str, Any]] = field(default_factory=list)  # {"id", "title"}

    def block(self, fence: str) -> str:
        """The numbered lists for the prompt. Names are other people's text, so they sit inside the fence."""
        lines = ["", "Files you may attach (attach_file):"]
        lines += [fenced(f"{i}. {f['name']}", fence) for i, f in enumerate(self.files, 1)] or ["(none)"]
        lines += ["", "Templates you may use (use_template):"]
        lines += [fenced(f"{i}. {t['title']}", fence) for i, t in enumerate(self.templates, 1)] or ["(none)"]
        return "\n".join(lines)


def with_action(schema: dict[str, Any]) -> dict[str, Any]:
    """The draft's answer schema with the optional action added. `required` is untouched, so a draft never fails for lack of one."""
    return {**schema, "properties": {**schema["properties"], "action": ACTION_PROPERTY}}


def _title(value: Any) -> str:
    """A title as one plain line, without dashes, cut to MAX_TITLE."""
    return plain_dashes(" ".join(str(value or "").split())).strip()[:MAX_TITLE]


def _pick(number: Any, items: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The item at a 1-based number the model gave, or None when it is not a whole number inside the list."""
    if isinstance(number, bool) or not isinstance(number, int) or not 1 <= number <= len(items):
        return None
    return items[number - 1]


def _due(value: Any, today: date) -> str | None:
    """A YYYY-MM-DD date from today to a year ahead, else None."""
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value.strip()):
        return None
    try:
        day = date.fromisoformat(value.strip())
    except ValueError:
        return None
    return day.isoformat() if today <= day <= today + timedelta(days=DUE_WINDOW_DAYS) else None


def validate(raw: Any, offer: Offer, today: date) -> dict[str, Any] | None:
    """The action to store from what the model returned, or None. Unknown kinds, picks outside the lists and empty titles
    are dropped, so an invented file or template can never reach the app. Returns {"kind": ..., "args": {...}}."""
    if not isinstance(raw, dict) or raw.get("kind") not in KINDS:
        return None
    kind = raw["kind"]
    if kind == "book_meeting":
        title = _title(raw.get("title"))
        minutes = raw.get("minutes")
        return {"kind": kind, "args": {"title": title, "minutes": minutes if minutes in MINUTES else 60}} if title else None
    if kind == "create_task":
        title = _title(raw.get("title"))
        return {"kind": kind, "args": {"title": title, "due": _due(raw.get("due"), today)}} if title else None
    if kind == "attach_file":
        f = _pick(raw.get("file"), offer.files)
        return {"kind": kind, "args": {"attachment_id": f["id"], "name": f["name"]}} if f else None
    t = _pick(raw.get("template"), offer.templates)
    return {"kind": kind, "args": {"template_id": t["id"], "title": t["title"]}} if t else None


def gather(db: Any, vault: Any, user: str, thread_id: str) -> Offer:
    """The files from this conversation and the user's templates the model may choose from. Reads only; never fails the
    draft: whatever cannot be read is left out, and an empty offer still allows meetings and tasks."""
    offer = Offer()
    try:
        rows = db.select("attachments", {
            "select": "id,filename,messages!inner(thread_id)", "user_id": f"eq.{user}", "messages.thread_id": f"eq.{thread_id}",
            "hidden": "eq.false", "is_sticker": "eq.false", "storage_path": "not.is.null", "order": "created_at.desc", "limit": str(MAX_CANDIDATES),
        })
        for r in rows:
            name = _title(vault.open(user, FILENAME, r.get("filename")))
            if name:
                offer.files.append({"id": r["id"], "name": name})
    except Exception as err:
        log.warn("action files not read", thread=thread_id, code=log.code_of(err))
    try:
        rows = db.select("user_templates", {"select": "id,title", "user_id": f"eq.{user}", "kind": "eq.template", "order": "position", "limit": str(MAX_CANDIDATES)})
        offer.templates = [{"id": r["id"], "title": _title(r.get("title"))} for r in rows if _title(r.get("title"))]
    except Exception as err:
        log.warn("action templates not read", thread=thread_id, code=log.code_of(err))
    return offer


def prompt_block(offer: Offer, seed: str) -> str:
    """The lists appended to a draft prompt. seed keeps the fence stable for the same draft, so a retried prompt is identical."""
    return offer.block(new_fence(seed))


def propose(db: Any, vault: Any, user: str, thread_id: str, draft_id: str, raw: Any, offer: Offer, now: datetime | None = None) -> bool:
    """Stores the model's action as a proposal for the draft, if it passes validation. Returns whether a row was written.
    Never raises: a draft is already written and must not fail over its extra. The app shows only the proposals of the
    draft in the box, so an older draft's are simply not shown."""
    try:
        action = validate(raw, offer, (now or datetime.now(timezone.utc)).date())
        if not action:
            return False
        db.insert("actions", {
            "user_id": user, "thread_id": thread_id, "draft_id": draft_id, "kind": action["kind"],
            "args": vault.seal(user, ACTION, json.dumps(action["args"], ensure_ascii=False)),
        })
        log.info("action proposed", draft=draft_id, kind=action["kind"])
        return True
    except Exception as err:
        log.warn("action not stored", draft=draft_id, code=log.code_of(err))
        return False
