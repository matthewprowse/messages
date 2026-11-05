"""A content-free error reporter, like apps/worker/src/ops/errors.ts. An error becomes a code, the class name, the place it
was caught (a fixed word chosen by the caller) and stack frames (function, file inside the repo, line). Never the error's
message, which can echo message text, a name or an address, never source lines and never local variables. Each report is
counted and logged as JSON; when ERROR_TRACKER_DSN is set it is also forwarded to a Sentry-compatible tracker through the
Sink interface, using Sentry's envelope protocol over urllib (an SDK captures request data and locals by default)."""

from __future__ import annotations

import json
import os
import re
import secrets
import threading
import time
import traceback
import urllib.request
from typing import Protocol
from urllib.parse import urlparse

from .. import log
from .metrics import count_failure, safe_label

MAX_FRAMES = 12
FORWARD_EVERY_S = 60.0  # one forward per place and code a minute: a failing loop must not flood the tracker (counts still go up)
_ROOT = re.compile(r"(?:^|/)(?:apps/ai/)?((?:ai|site-packages)/.*)$")


class Sink(Protocol):
    def capture(self, report: dict) -> None: ...


def trim_path(path: str) -> str:
    """A path cut to where it sits in the package, so no home directory or user name is reported."""
    m = _ROOT.search(path.replace("\\", "/"))
    return m.group(1) if m else path.replace("\\", "/").rsplit("/", 1)[-1]


def frames_of(tb: object) -> list[dict]:
    """Frames oldest first from a traceback. FrameSummary.line (source text) and locals are deliberately not read."""
    out = []
    for f in traceback.extract_tb(tb)[-MAX_FRAMES:]:  # type: ignore[arg-type]
        out.append({"fn": f.name, "file": trim_path(f.filename), "line": f.lineno})
    return out


def trail(err: BaseException) -> str:
    """The frames newest first as one short line, for a log line that has no report of its own."""
    return " < ".join(f'{f["fn"]}@{f["file"]}:{f["line"]}' for f in reversed(frames_of(err.__traceback__)))


def describe(err: BaseException, where: str) -> dict:
    return {"code": safe_label(log.code_of(err)), "cls": safe_label(type(err).__name__), "where": safe_label(where), "frames": frames_of(err.__traceback__)}


_sink: Sink | None = None
_last_forward: dict[str, float] = {}
_lock = threading.Lock()


def set_sink(sink: Sink | None) -> None:
    global _sink
    _sink = sink


def report(err: BaseException, where: str, now: float | None = None) -> dict:
    """Counts, logs and (if a tracker is set up) forwards one error. Never raises."""
    r = describe(err, where)
    try:
        count_failure(r["code"], r["where"])
        trail = " < ".join(f'{f["fn"]}@{f["file"]}:{f["line"]}' for f in reversed(r["frames"]))
        log.error(f'{r["where"]} failed', code=r["code"], cls=r["cls"], where=r["where"], frames=trail)
        key = f'{r["where"]}:{r["code"]}'
        t = time.monotonic() if now is None else now
        with _lock:
            due = _sink is not None and t - _last_forward.get(key, -FORWARD_EVERY_S) >= FORWARD_EVERY_S
            if due:
                _last_forward[key] = t
        if due and _sink is not None:
            _sink.capture(r)
    except Exception:
        pass  # reporting must never be the thing that breaks the caller
    return r


def parse_dsn(dsn: str) -> tuple[str, str] | None:
    """`https://<key>@host/<project>` to (envelope URL, public key); None when it is not one."""
    try:
        u = urlparse(dsn)
        parts = [p for p in u.path.split("/") if p]
        if not u.username or not parts or u.scheme not in ("https", "http") or not u.hostname:
            return None
        project, prefix = parts[-1], parts[:-1]
        host = u.hostname + (f":{u.port}" if u.port else "")
        return f'{u.scheme}://{host}{"/" + "/".join(prefix) if prefix else ""}/api/{project}/envelope/', u.username
    except ValueError:
        return None


def envelope_for(r: dict, service: str, dsn: str, now: float | None = None, event_id: str | None = None) -> str:
    """The envelope body for one report: only the code, class, place and frames. No user, request, locals or message."""
    t = time.time() if now is None else now
    eid = event_id or secrets.token_hex(16)
    event = {
        "event_id": eid,
        "timestamp": int(t),
        "platform": "python",
        "level": "error",
        "logger": service,
        "tags": {"service": service, "where": r["where"], "code": r["code"]},
        "exception": {"values": [{"type": r["cls"], "value": r["code"], "stacktrace": {"frames": [{"function": f["fn"], "filename": f["file"], "lineno": f["line"]} for f in r["frames"]]}}]},
    }
    header = {"event_id": eid, "sent_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t)), "dsn": dsn}
    return "\n".join(json.dumps(x) for x in (header, {"type": "event"}, event))


class SentrySink:
    """The tracker client. Posts in a thread so a slow tracker never holds a loop; an outage is ignored."""

    def __init__(self, dsn: str, service: str, post=None):
        parsed = parse_dsn(dsn)
        if parsed is None:
            raise ValueError("bad DSN")
        self.url, self.key = parsed
        self.dsn, self.service = dsn, service
        self._post = post or self._http_post

    def _http_post(self, url: str, headers: dict, body: bytes) -> None:
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        urllib.request.urlopen(req, timeout=5).close()

    def capture(self, report: dict) -> None:
        headers = {"content-type": "application/x-sentry-envelope", "x-sentry-auth": f"Sentry sentry_version=7, sentry_client=konva-ops/1, sentry_key={self.key}"}
        body = envelope_for(report, self.service, self.dsn).encode()

        def send() -> None:
            try:
                self._post(self.url, headers, body)
            except Exception:
                pass

        threading.Thread(target=send, name="error-forward", daemon=True).start()


def init(service: str, dsn: str | None = None) -> None:
    """Sets up forwarding from ERROR_TRACKER_DSN. Unset or malformed: errors are still counted and logged."""
    dsn = dsn if dsn is not None else os.environ.get("ERROR_TRACKER_DSN", "")
    if not dsn:
        return
    try:
        set_sink(SentrySink(dsn, service))
    except ValueError:
        log.warn("ERROR_TRACKER_DSN is set but not a valid DSN: errors are logged only")
