"""LinkedIn's real-time stream: a long-lived server-sent-events request that the web app keeps open for new messages.

Reads `data: {...}` lines from /realtime/connect and turns them into the helper's events (connected, heartbeat,
reconnecting, message, conversation, bad_credentials, failed). Reconnects with growing, jittered waits after a drop;
a sign-out ends it for good, and so do several failures in a row. Personal messaging topics are subscribed by LinkedIn
itself when the stream connects (the ClientConnection event lists them). Message events are mapped by mapping.events_from,
which has not yet been checked against a captured message event."""

from __future__ import annotations

import json
import random
import threading
import time
import urllib.request
import uuid
from typing import Callable

from . import mapping, queries, wire
from .session import ORIGIN, Session

HEARTBEAT_S = 60
GIVE_UP_AFTER = 8  # failures in a row
STABLE_S = 60.0  # a stream that stayed up this long was a real connection; one that closes at once is still a failure
READ_TIMEOUT_S = 150  # heartbeats arrive about once a minute; silence this long means the stream is dead


class Realtime(threading.Thread):
    def __init__(self, session: Session, on_event: Callable[[dict], None], sleep: Callable[[float], None] = None) -> None:
        super().__init__(daemon=True)
        self.s, self.emit, self.stopped = session, on_event, threading.Event()
        self.wait = sleep or self.stopped.wait
        self.resp = None
        self.session_id = ""

    def stop(self) -> None:
        self.stopped.set()
        resp = self.resp
        if resp is not None:
            try: resp.close()
            except Exception: pass

    def headers(self) -> dict:
        qmap = {"topicToGraphQLQueryParams": {t: {"queryId": q, "variables": {}, "extensions": {}} for t, q in queries.REALTIME_QUERIES.items()}}
        return self.s.headers("text/event-stream", extra={"Accept-Encoding": "identity", "Cache-Control": "no-cache", "x-li-accept": "application/vnd.linkedin.normalized+json+2.1", "x-li-query-accept": "application/graphql", "x-li-query-map": json.dumps(qmap, separators=(",", ":")), "x-li-recipe-accept": "application/vnd.linkedin.normalized+json+2.1", "x-li-recipe-map": json.dumps(queries.REALTIME_RECIPES, separators=(",", ":")), "x-li-realtime-session": self.session_id})

    def run(self) -> None:
        failures = 0
        while not self.stopped.is_set():
            started = time.monotonic()
            try:
                got = self.stream()
                failures = 0 if got and time.monotonic() - started >= STABLE_S else failures + 1
            except wire.ResponseError as e:
                if e.status in (401, 302, 303): self.emit({"event": "bad_credentials", "error": wire.error(wire.BAD_CREDENTIALS, e.status)}); return
                failures += 1
            except Exception:
                if self.stopped.is_set(): return
                failures += 1
            if self.stopped.is_set(): return
            if failures >= GIVE_UP_AFTER: self.emit({"event": "failed", "error": wire.error(wire.FAILED)}); return
            self.emit({"event": "reconnecting"})
            self.wait(min(300.0, 5.0 * 2 ** min(failures, 6)) * random.uniform(0.75, 1.25) if failures else 2.0)

    def stream(self) -> bool:
        """One connection. Returns whether it connected, and ends when the stream does."""
        self.session_id = str(uuid.uuid4())
        req = urllib.request.Request(ORIGIN + "/realtime/connect?rc=1", headers=self.headers(), method="GET")
        try: resp = self.s.open(req, timeout=READ_TIMEOUT_S)
        except Exception as e:
            code = getattr(e, "code", None)
            if code: raise wire.ResponseError(code) from None
            raise
        self.resp, connected, beat = resp, False, None
        try:
            for raw in resp:
                if self.stopped.is_set(): break
                line = raw.decode("utf-8", "replace").strip() if isinstance(raw, bytes) else raw.strip()
                if not line.startswith("data:"): continue
                try: obj = json.loads(line[5:])
                except ValueError: continue
                if not isinstance(obj, dict) or not obj: continue
                kind, payload = next(iter(obj.items()))
                if kind.endswith("ClientConnection"):
                    connected = True
                    self.emit({"event": "connected"})
                    beat = threading.Thread(target=self.heartbeats, args=(self.session_id,), daemon=True); beat.start()
                elif kind.endswith("Heartbeat"): self.emit({"event": "heartbeat"})
                elif kind.endswith("DecoratedEvent"):
                    for ev in mapping.events_from(payload if isinstance(payload, dict) else {}): self.emit(ev)
        finally:
            try: resp.close()
            except Exception: pass
            self.resp = None
        return connected

    def heartbeats(self, session_id: str) -> None:
        """Tells LinkedIn the page is still open, once a minute, as the web app does; a missed one is not an error."""
        first = True
        while not self.stopped.is_set() and session_id == self.session_id:
            try: self.s.post_json("/realtime/realtimeFrontendClientConnectivityTracking?action=sendHeartbeat", {"isFirstHeartbeat": first, "isLastHeartbeat": False, "realtimeSessionId": session_id, "mpName": "voyager-web", "mpVersion": queries.CLIENT_VERSION, "clientId": "voyager-web"})
            except Exception: pass
            first = False
            if self.stopped.wait(HEARTBEAT_S): return
