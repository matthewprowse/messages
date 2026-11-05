"""How the AI worker names the place of a value it seals, the same way packages/crypto/src/places.ts does for the web
app and the sync worker: "<table>.<column>", and for the rows an action is taken from, the row's own id as well.
Pure.

The connectors (Instagram, iCloud Reminders) seal what they ingest bound to its place only, like the sync worker's
ingest does: the row id is not known before the insert. The action rows the AI worker itself makes (task_updates,
drafts) choose their id first and bind to it (automations/do.py, drafts_stream.py)."""

from __future__ import annotations


def place_of(table: str, column: str) -> str:
    """"<table>.<column>", as places.ts placeOfColumn."""
    return f"{table}.{column}"


# The columns the connectors write sealed text into.
CONTACT_NAME = place_of("contacts", "display_name")
CONTACT_HANDLE = place_of("contacts", "handle")
THREAD_GROUP_NAME = place_of("threads", "group_name")
MESSAGE_PREVIEW = place_of("messages", "preview")
MESSAGE_BODY = place_of("messages", "body_text")
ATTACHMENT_FILENAME = place_of("attachments", "filename")
TASK_TITLE = place_of("tasks", "title")
TASK_NOTES = place_of("tasks", "notes")
TASK_LIST_NAME = place_of("tasks", "list_name")
