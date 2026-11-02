"""Entry for python3 -m ai linkedin: reads commands as JSON lines on stdin, writes responses and events as JSON
lines on stdout. Closing stdin ends the process, and the session with it. Logs nothing: stderr is not read."""

from __future__ import annotations

import json
import sys
import threading

from . import wire
from .factory import VoyagerFactory
from .helper import Helper

MAX_LINE = 1 << 20  # a pasted cookie header can be long


def main(factory=None, stdin=None, stdout=None) -> None:
    stdin, stdout, lock = stdin or sys.stdin, stdout or sys.stdout, threading.Lock()

    def write(obj: dict) -> None:
        line = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
        with lock: stdout.write(line + "\n"); stdout.flush()

    h = Helper(write, factory or VoyagerFactory())
    write({"event": "ready"})
    for line in stdin:
        try:
            req = json.loads(line) if len(line) <= MAX_LINE else None
        except ValueError:
            req = None
        if not isinstance(req, dict):
            write(wire.fail(0, wire.error(wire.BAD_REQUEST)))
            continue
        resp, stop = h.dispatch(req)
        if resp is not None: write(resp)
        if stop: return
    h.end_wait()  # stdin closed: the worker went away
    h.drop()
