"""Keep-alive HTTPS for the worker's Supabase and Gemini requests.

urllib opens a new connection for every request, so each one pays for a TCP and a TLS handshake: about
two extra round trips, which is most of the time a small Supabase read takes. Here connections are kept
and shared by every thread, the most recently used first: a draft thread that sat idle for minutes takes
the connection the draft poll used half a second ago instead of opening a cold one. A connection the
server closed while it sat idle is replaced and the request sent again once, as nothing reached the server.
Responses are asked for gzipped, which makes large PostgREST reads several times smaller. stream() reads a response
as it comes instead (Gemini's server-sent events, for a draft shown while it is written)."""

from __future__ import annotations

import gzip
import http.client
import threading
import time
import urllib.parse
from collections.abc import Iterator
from dataclasses import dataclass

from .tls import CONTEXT

IDLE_S = 50.0  # servers drop idle connections after about a minute; start a fresh one before that
_CLOSED = (http.client.RemoteDisconnected, http.client.BadStatusLine, ConnectionResetError, ConnectionAbortedError, BrokenPipeError)


@dataclass(frozen=True)
class Response:
    status: int
    headers: dict[str, str]  # names in lower case
    body: bytes


class Pool:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._idle: dict[tuple[str, str], list[tuple[http.client.HTTPConnection, float]]] = {}  # oldest first

    def request(self, method: str, url: str, body: bytes | None = None, headers: dict[str, str] | None = None, *, timeout: float = 30.0) -> Response:
        """Raises OSError (timeouts included) or http.client.HTTPException when the request fails;
        an HTTP error status is returned, not raised."""
        parts = urllib.parse.urlsplit(url)
        key = (parts.scheme, parts.netloc)
        target = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
        send = {"Accept-Encoding": "gzip", **(headers or {})}
        for attempt in range(2):
            conn, reused = self._take(key, timeout)
            try:
                conn.request(method, target, body=body, headers=send)
                res = conn.getresponse()
                data = res.read()
            except _CLOSED:
                _close(conn)
                if reused and attempt == 0:
                    continue  # the server had closed it while idle
                raise
            except BaseException:
                _close(conn)
                raise
            if res.will_close:
                _close(conn)
            else:
                self._give(key, conn)
            if (res.getheader("Content-Encoding") or "").lower() == "gzip":
                data = gzip.decompress(data)
            return Response(res.status, {k.lower(): v for k, v in res.getheaders()}, data)
        raise http.client.HTTPException("connection closed")  # not reached

    def stream(self, method: str, url: str, body: bytes | None = None, headers: dict[str, str] | None = None, *, timeout: float = 30.0) -> Iterator[bytes]:
        """The response's lines as they arrive (not gzipped: a compressed stream cannot be read line by line). A status
        of 300 or more raises Refused with the whole body. Raises what request raises when the connection fails. The
        connection is kept for reuse only when the response was read to its end."""
        parts = urllib.parse.urlsplit(url)
        key = (parts.scheme, parts.netloc)
        target = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
        conn, reused = self._take(key, timeout)
        try:
            try:
                conn.request(method, target, body=body, headers=headers or {})
                res = conn.getresponse()
            except _CLOSED:
                _close(conn)
                if not reused:
                    raise
                conn, _ = self._take(key, timeout)  # the server had closed it while idle: once more, on a fresh one
                conn.request(method, target, body=body, headers=headers or {})
                res = conn.getresponse()
            if res.status >= 300:
                data = res.read()
                raise Refused(Response(res.status, {k.lower(): v for k, v in res.getheaders()}, data))
            yield from res
        except BaseException:
            _close(conn)
            raise
        if res.will_close:
            _close(conn)
        else:
            self._give(key, conn)

    def close(self) -> None:
        """Closes every idle connection."""
        with self._lock:
            idle = [conn for stack in self._idle.values() for conn, _ in stack]
            self._idle.clear()
        for conn in idle:
            _close(conn)

    def _take(self, key: tuple[str, str], timeout: float) -> tuple[http.client.HTTPConnection, bool]:
        """The most recently used idle connection to this host, or a new one. Only one thread holds a
        connection at a time: it is out of the pool until given back."""
        stale = []
        found = None
        with self._lock:
            stack = self._idle.get(key) or []
            while stack:
                conn, at = stack.pop()
                if time.monotonic() - at < IDLE_S and conn.sock is not None:
                    found = conn
                    break
                stale.append(conn)  # everything below it is older still, and goes the same way when reached
        for conn in stale:
            _close(conn)
        if found:
            found.sock.settimeout(timeout)
            return found, True
        scheme, host = key
        if scheme == "https":
            return http.client.HTTPSConnection(host, timeout=timeout, context=CONTEXT), False
        return http.client.HTTPConnection(host, timeout=timeout), False

    def _give(self, key: tuple[str, str], conn: http.client.HTTPConnection) -> None:
        now = time.monotonic()
        with self._lock:
            stack = self._idle.setdefault(key, [])
            stack.append((conn, now))
            stale = [c for c, at in stack if now - at >= IDLE_S]
            if stale:
                stack[:] = [(c, at) for c, at in stack if now - at < IDLE_S]
        for c in stale:
            _close(c)


class Refused(Exception):
    """A streamed request answered with an error status; response holds it, read in full."""

    def __init__(self, response: Response):
        super().__init__(response.status)
        self.response = response


def _close(conn: http.client.HTTPConnection) -> None:
    try:
        conn.close()
    except OSError:
        pass


POOL = Pool()
