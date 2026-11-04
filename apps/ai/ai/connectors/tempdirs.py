"""Private temporary folders a connector left behind when its process was killed mid-run (konva-icloud-* holds Apple
session cookies, konva-ig-* outgoing files). Each connector removes its own at startup; a folder still in use by another
process is never touched, as only ones untouched for MAX_AGE_S are removed. Only counts are logged."""

from __future__ import annotations

import os
import shutil
import tempfile
import time

from .. import log

MAX_AGE_S = 6 * 60 * 60.0  # far longer than any one run keeps a folder open


def _newest(path: str) -> float:
    """The latest change to the folder or anything directly in it: pyicloud rewrites its files in place, which a
    folder's own time does not show."""
    newest = os.lstat(path).st_mtime
    for entry in os.scandir(path):
        try:
            newest = max(newest, entry.stat(follow_symlinks=False).st_mtime)
        except OSError:
            continue
    return newest


def sweep_stale(prefix: str, root: str | None = None, max_age_s: float = MAX_AGE_S, now: float | None = None) -> int:
    """Removes this user's folders named prefix* in the temp folder that nothing has touched for max_age_s. Returns how
    many were removed. Never raises: a folder that cannot be read or removed is left for the next start."""
    root = root or tempfile.gettempdir()
    now = time.time() if now is None else now
    removed = 0
    try:
        entries = list(os.scandir(root))
    except OSError:
        return 0
    for entry in entries:
        try:
            if not entry.name.startswith(prefix) or not entry.is_dir(follow_symlinks=False):
                continue
            if entry.stat(follow_symlinks=False).st_uid != os.getuid() or now - _newest(entry.path) < max_age_s:
                continue
            shutil.rmtree(entry.path)
            removed += 1
        except OSError:
            continue
    if removed:
        log.info("stale temporary folders removed", prefix=prefix, count=removed)
    return removed
