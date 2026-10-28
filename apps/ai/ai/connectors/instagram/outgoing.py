"""The files of an outbox row, read from the app's uploads and checked before anything is sent.

Mirrors apps/worker/src/send/outbox-attachments.ts and attachment-rules.ts: the app uploads each file to the
private "attachments" bucket at "<user id>/outbox/<uuid>/<filename>", inserts the outbox row with
attachment_count, then adds one outbox_attachments row per file. The connector waits for those rows, accepts
only paths under the row's own user, and caps what it downloads. What goes to Instagram is decided by the
bytes, not by the name or type the app recorded."""

from __future__ import annotations

import os
import re
import threading
import time
from dataclasses import dataclass
from typing import Any

MAX_FILES = 10  # on every provider (MAX_ATTACHMENTS in attachment-rules.ts)
MAX_FILE_BYTES = 50 * 1024 * 1024
WAIT_S = 60.0
POLL_S = 1.0

NOT_UPLOADED = "The attachments did not finish uploading. Try again."
CHANGED = "The attachments changed while sending. Try again."
MISSING = "An attachment could not be found. Try again."
TOO_MANY = f"You can send up to {MAX_FILES} attachments at once."
TOO_LARGE = "Instagram files can be up to 50 MB each."
ONLY_MEDIA = "Instagram can only take photos and videos. Send other files another way."
UNREADABLE = "The attachments could not be read. Try again."

UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
USER_ID = re.compile(f"^{UUID}$")
NAME = "[A-Za-z0-9()][A-Za-z0-9._() -]{0,99}"


class Rejected(Exception):
    """The row cannot go; reason is what to show beside it. Nothing has been sent."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class OutFile:
    path: str  # in the temporary folder, named by us
    kind: str  # "photo" or "video"


def own_outbox_path(user_id: str, path: str) -> bool:
    """True when a stored file is exactly "<user id>/outbox/<uuid>/<safe name>", the format the app writes. The
    service role downloads these paths, so a "%", a "..", or an extra folder must never get through."""
    if not USER_ID.match(user_id or ""):
        return False
    return re.match(f"^{user_id}/outbox/{UUID}/{NAME}$", path or "") is not None


def sniff(data: bytes) -> tuple[str, str] | None:
    """('photo' or 'video', file extension) from the first bytes, or None for anything Instagram's private
    API will not take (GIFs, QuickTime, documents). instagrapi picks its upload path from the extension."""
    if data[:3] == b"\xff\xd8\xff":
        return "photo", ".jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "photo", ".png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "photo", ".webp"
    if data[4:8] == b"ftyp" and data[8:12] != b"qt  ":
        return "video", ".mp4"
    return None


def wait_for_files(store: Any, row: dict[str, Any], stop: threading.Event, wait_s: float = WAIT_S, clock: Any = None) -> str | None:
    """Waits until the app has added every file row for this outbox row, up to a minute. None when they are
    all there, else the reason to fail the row with."""
    expected = int(row.get("attachment_count") or 0)
    if expected <= 0:
        return None
    clock = clock or time.monotonic
    deadline = clock() + wait_s
    while True:
        found = store.count_outbox_files(row["id"])
        if found > expected:
            return CHANGED
        if found == expected:
            return None
        if clock() >= deadline or stop.is_set():
            return NOT_UPLOADED
        stop.wait(POLL_S)


def load_files(store: Any, row: dict[str, Any], folder: str) -> list[OutFile]:
    """Checks the row's files and writes them, in order, into folder (a private temporary directory). Raises
    Rejected with the reason when they cannot go. A storage outage raises as it is."""
    expected = int(row.get("attachment_count") or 0)
    rows = store.outbox_files(row["id"], expected + 1)
    if len(rows) > expected:
        raise Rejected(CHANGED)
    if len(rows) < expected:
        raise Rejected(NOT_UPLOADED)
    if expected > MAX_FILES:
        raise Rejected(TOO_MANY)
    if any(r.get("user_id") != row.get("user_id") or not own_outbox_path(str(row.get("user_id")), str(r.get("storage_path"))) for r in rows):
        raise Rejected(MISSING)
    for r in rows:  # before anything is downloaded
        declared = str(r.get("mime_type") or "").lower()
        if not (declared.startswith("image/") or declared.startswith("video/")):
            raise Rejected(ONLY_MEDIA)
        if not isinstance(r.get("size_bytes"), int) or r["size_bytes"] > MAX_FILE_BYTES:
            raise Rejected(TOO_LARGE)
    files: list[OutFile] = []
    for n, r in enumerate(rows):
        data = store.download_outbox_file(r["storage_path"])
        if not data:
            raise Rejected(MISSING)
        if len(data) > MAX_FILE_BYTES:
            raise Rejected(TOO_LARGE)
        found = sniff(data)
        if not found:
            raise Rejected(ONLY_MEDIA)
        kind, ext = found
        path = os.path.join(folder, f"{n}{ext}")  # our own name, never the one the app recorded
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as out:
            out.write(data)
        files.append(OutFile(path, kind))
    return files
