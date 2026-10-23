"""Keep-alive HTTPS for the worker's Supabase and Gemini requests.

urllib opens a new connection for every request, so each one pays for a TCP and a TLS handshake: about
two extra round trips, which is most of the time a small Supabase read takes. Here each thread keeps one
connection per host and reuses it. A connection the server closed while it sat idle is replaced and the
request sent again once, as nothing reached the server. Responses are asked for gzipped, which makes
large PostgREST reads several times smaller."""

from __future__ import annotations

import gzip
import http.client
import threading
import time
import urllib.parse
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
        self._local = threading.local()

    def request(self, method: str, url: str, body: bytes | None = None, headers: dict[str, str] | None = None, *, timeout: float = 30.0) -> Response:
        """Raises OSError (timeouts included) or http.client.HTTPException when the request fails;
        an HTTP error status is returned, not raised."""
        parts = urllib.parse.urlsplit(url)
        key = (parts.scheme, parts.netloc)
        target = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
        send = {"Accept-Encoding": "gzip", **(headers or {})}
        for attempt in range(2):
            conn, reused = self._connection(key, timeout)
            try:
                conn.request(method, target, body=body, headers=send)
                res = conn.getresponse()
                data = res.read()
            except _CLOSED:
                self._drop(key)
                if reused and attempt == 0:
                    continue  # the server had closed it while idle
                raise
            except BaseException:
                self._drop(key)
                raise
            if res.will_close:
                self._drop(key)
            else:
                self._conns()[key] = (conn, time.monotonic())
            if (res.getheader("Content-Encoding") or "").lower() == "gzip":
                data = gzip.decompress(data)
            return Response(res.status, {k.lower(): v for k, v in res.getheaders()}, data)
        raise http.client.HTTPException("connection closed")  # not reached

    def close(self) -> None:
        """Closes this thread's connections."""
        for key in list(self._conns()):
            self._drop(key)

    def _conns(self) -> dict[tuple[str, str], tuple[http.client.HTTPConnection, float]]:
        if not hasattr(self._local, "conns"):
            self._local.conns = {}
        return self._local.conns

    def _connection(self, key: tuple[str, str], timeout: float) -> tuple[http.client.HTTPConnection, bool]:
        conns = self._conns()
        found = conns.get(key)
        if found and time.monotonic() - found[1] < IDLE_S and found[0].sock is not None:
            found[0].sock.settimeout(timeout)
            return found[0], True
        if found:
            self._drop(key)
        scheme, host = key
        if scheme == "https":
            conn: http.client.HTTPConnection = http.client.HTTPSConnection(host, timeout=timeout, context=CONTEXT)
        else:
            conn = http.client.HTTPConnection(host, timeout=timeout)
        conns[key] = (conn, time.monotonic())
        return conn, False

    def _drop(self, key: tuple[str, str]) -> None:
        found = self._conns().pop(key, None)
        if found:
            try:
                found[0].close()
            except OSError:
                pass


POOL = Pool()
