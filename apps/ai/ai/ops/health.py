"""Liveness and readiness for the supervisor, like apps/worker/src/ops/health.ts. Liveness says the process answers.
Readiness says the worker is doing its job: it holds its lease and its draft loop ticked recently, so a worker that hangs
or lost its lease is restarted. The decision is a pure function; the HTTP server is a thin wrapper. Only booleans, fixed
reason codes and ages in seconds are reported, never content."""

from __future__ import annotations

import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable

from .metrics import render_prometheus

MAX_TICK_AGE_S = 120.0  # the draft loop turns about once a second; this tolerates a long Gemini call in it


def readiness(now: float, started_at: float, lease_held: bool, last_tick_at: float | None, max_tick_age_s: float = MAX_TICK_AGE_S) -> dict:
    reasons = []
    if not lease_held:
        reasons.append("lease_not_held")
    if last_tick_at is None:
        reasons.append("no_tick_yet")
    elif now - last_tick_at > max_tick_age_s:
        reasons.append("tick_stale")
    return {
        "ready": not reasons,
        "reasons": reasons,
        "uptimeS": max(0, round(now - started_at)),
        "lastTickAgeS": None if last_tick_at is None else max(0, round(now - last_tick_at)),
    }


def health_port(raw: str | None) -> int | None:
    """The port from HEALTH_PORT, or None when unset, "off" or not a port: the endpoint is then not started (local development)."""
    if not raw or raw == "off":
        return None
    try:
        n = int(raw)
    except ValueError:
        return None
    return n if 0 < n < 65536 else None


class Health:
    def __init__(self, clock: Callable[[], float] = time.monotonic, max_tick_age_s: float = MAX_TICK_AGE_S):
        self._clock = clock
        self._started = clock()
        self._max = max_tick_age_s
        self._last_tick: float | None = None
        self._lease_held = True

    def tick(self) -> None:
        """The main loop completed a turn."""
        self._last_tick = self._clock()

    def set_lease_held(self, held: bool) -> None:
        self._lease_held = held

    def respond(self, path: str) -> tuple[int, str, str]:
        """(status, content type, body) for a GET."""
        if path == "/healthz":
            return 200, "application/json", json.dumps({"alive": True})
        if path == "/readyz":
            r = readiness(self._clock(), self._started, self._lease_held, self._last_tick, self._max)
            return (200 if r["ready"] else 503), "application/json", json.dumps(r)
        if path == "/metrics":
            return 200, "text/plain; version=0.0.4", render_prometheus()
        return 404, "application/json", json.dumps({"error": "not_found"})


def health_host(raw: str | None) -> str:
    """The address to listen on, from HEALTH_HOST: loopback by default, as the image's HEALTHCHECK probes from inside the
    container and nothing is published. A supervisor that probes from outside (Cloud Run, a Confidential Space VM) sets
    HEALTH_HOST=0.0.0.0, as for the sync worker (apps/worker/src/ops/health.ts)."""
    return (raw or "").strip() or "127.0.0.1"


def serve(health: Health, port: int, host: str | None = None) -> ThreadingHTTPServer:
    """Starts the endpoint in a daemon thread on host (health_host of HEALTH_HOST when not given). GET only."""

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 (name fixed by http.server)
            status, kind, body = health.respond(self.path.split("?", 1)[0])
            data = body.encode()
            self.send_response(status)
            self.send_header("content-type", kind)
            self.send_header("cache-control", "no-store")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *_args: object) -> None:  # the default writes every probe to stderr
            pass

    server = ThreadingHTTPServer((host or health_host(os.environ.get("HEALTH_HOST")), port), Handler)
    threading.Thread(target=server.serve_forever, name="health", daemon=True).start()
    return server
