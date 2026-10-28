"""pyicloud's trusted session, kept between runs without leaving files behind.

pyicloud keeps a session as two files in a cookie directory: <apple id>.cookiejar (Apple's cookies) and
<apple id>.session (its session data, with the session token and the trust token that lets a later sign-in
skip two-factor). They are written after every request. Here the directory is a private temporary one, the
two files are restored into it from what was saved (sealed under the owner's own key, in
account_credentials.refreshed), and read back out to be saved again, so nothing of Apple's session ever sits
on disk beyond the run. Nothing here logs a cookie or a token."""

from __future__ import annotations

import atexit
import os
import re
import shutil
import tempfile
import threading
from typing import Any

_open: set[str] = set()
_lock = threading.Lock()


def _close_all() -> None:
    """Whatever is still open when the process ends (a thread cut off mid-run) is removed too."""
    for path in list(_open):
        shutil.rmtree(path, ignore_errors=True)


atexit.register(_close_all)


def _stem(apple_id: str) -> str:
    """The file name pyicloud gives an Apple ID (pyicloud/session.py): its word characters."""
    return "".join(c for c in apple_id if re.match(r"\w", c))


class SessionDir:
    """A private temporary cookie directory for one Apple ID. Use as a context manager; removed on exit."""

    def __init__(self, apple_id: str):
        self.stem = _stem(apple_id)
        self.path = tempfile.mkdtemp(prefix="konva-icloud-")  # 0700
        os.chmod(self.path, 0o700)
        with _lock:
            _open.add(self.path)

    def _file(self, kind: str) -> str:
        return os.path.join(self.path, f"{self.stem}.{kind}")

    def restore(self, saved: dict[str, Any] | None) -> bool:
        """Writes a saved session back as pyicloud's files. False when there is none to restore."""
        if not saved or not saved.get("session"):
            return False
        for kind in ("cookiejar", "session"):
            text = saved.get(kind)
            if isinstance(text, str):
                with open(self._file(kind), "w", encoding="utf-8") as out:
                    out.write(text)
                os.chmod(self._file(kind), 0o600)
        return True

    def dump(self) -> dict[str, str] | None:
        """The session as pyicloud last wrote it, or None when it has not written one."""
        saved: dict[str, str] = {}
        for kind in ("cookiejar", "session"):
            try:
                with open(self._file(kind), encoding="utf-8") as src:
                    saved[kind] = src.read()
            except OSError:
                pass
        return saved if saved.get("session") else None

    def close(self) -> None:
        shutil.rmtree(self.path, ignore_errors=True)
        with _lock:
            _open.discard(self.path)

    def __enter__(self) -> "SessionDir":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()
