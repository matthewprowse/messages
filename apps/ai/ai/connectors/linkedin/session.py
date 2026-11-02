"""One signed-in LinkedIn web session: the cookies and browser headers an account signed in with, and the HTTP
requests made with them the way the web app makes its own (the same headers, no redirects followed). Standard
library only. A status of 300 or more raises ResponseError, so a redirect to the sign-in page reads as a sign-out.
Never logs a URL, header or body: they hold the session and message text."""

from __future__ import annotations

import gzip
import http.cookies
import json
import urllib.error
import urllib.request
import uuid
from typing import Any, Callable, Optional
from urllib.parse import quote

from .queries import CLIENT_VERSION
from .wire import ResponseError

ORIGIN = "https://www.linkedin.com"
DEFAULT_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
DEFAULT_TRACK = {"clientVersion": CLIENT_VERSION, "mpVersion": CLIENT_VERSION, "osName": "web", "timezoneOffset": 0, "timezone": "UTC", "deviceFormFactor": "DESKTOP", "mpName": "voyager-web", "displayDensity": 2, "displayWidth": 1920, "displayHeight": 1080}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None


def rest(v: Any) -> str:
    """A value in the Rest.li form LinkedIn's `variables` take: (a:b,c:List(d,e)). Strings are percent-encoded whole,
    the way the web app sends URNs and tokens; the structure characters are not."""
    if isinstance(v, dict): return "(" + ",".join(f"{k}:{rest(x)}" for k, x in v.items()) + ")"
    if isinstance(v, (list, tuple)): return "List(" + ",".join(rest(x) for x in v) + ")"
    if isinstance(v, bool): return "true" if v else "false"
    return quote(str(v), safe="")


def cookie_dict(header: str) -> dict:
    out = {}
    for part in header.split(";"):
        k, sep, v = part.strip().partition("=")
        if sep and k: out[k] = v
    return out


class Session:
    def __init__(self, cookies: str, headers: Optional[dict] = None, page_instance: str = "", x_li_track: str = "", opener: Optional[Callable] = None) -> None:
        self.cookies = cookie_dict(cookies)
        self.base = {k: (v[0] if isinstance(v, list) and v else str(v)) for k, v in (headers or {}).items() if v}
        if not any(k.lower() == "user-agent" for k in self.base): self.base["User-Agent"] = DEFAULT_UA
        try: ok = json.loads(x_li_track).get("mpName") == "voyager-web"
        except (ValueError, AttributeError): ok = False
        self.track = x_li_track if ok else json.dumps(DEFAULT_TRACK, separators=(",", ":"))
        self.page = page_instance if ok and page_instance else "urn:li:page:d_flagship3_feed;" + str(uuid.uuid4())
        self.open = opener or urllib.request.build_opener(_NoRedirect).open  # proxies come from the environment

    @property
    def csrf(self) -> str: return self.cookies.get("JSESSIONID", "").strip('"')

    def cookie_header(self) -> str: return "; ".join(f"{k}={v}" for k, v in self.cookies.items())

    def headers(self, accept: str, content_type: str = "", extra: Optional[dict] = None) -> dict:
        h = {**self.base, "Accept": accept, "Accept-Language": "en-US,en;q=0.9", "Accept-Encoding": "gzip", "csrf-token": self.csrf, "x-li-lang": "en_US", "x-li-track": self.track, "x-li-page-instance": self.page, "x-restli-protocol-version": "2.0.0", "Referer": ORIGIN + "/messaging/", "Cookie": self.cookie_header()}
        if content_type: h["Content-Type"], h["Origin"] = content_type, ORIGIN
        h.update(extra or {})
        return h

    def request(self, method: str, url: str, headers: dict, body: Optional[bytes] = None, timeout: float = 60) -> tuple[bytes, Any]:
        """Makes one request and returns (body, response headers). One attempt, never retried: a send that is retried is
        a send twice. Raises ResponseError for a status of 300 or more, OSError when LinkedIn cannot be reached."""
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with self.open(req, timeout=timeout) as resp:
                self.keep_cookies(resp.headers)
                data = resp.read()
                if (resp.headers.get("Content-Encoding") or "").lower() == "gzip": data = gzip.decompress(data)
                return data, resp.headers
        except urllib.error.HTTPError as e:
            raise ResponseError(e.code) from None
        except urllib.error.URLError as e:
            raise OSError("linkedin unreachable") from None

    def keep_cookies(self, headers: Any) -> None:
        """LinkedIn rotates cookies such as JSESSIONID on a response; the next request must carry the new one."""
        get_all = getattr(headers, "get_all", None)
        for line in (get_all("Set-Cookie") if get_all else None) or []:
            jar = http.cookies.SimpleCookie()
            try: jar.load(line)
            except http.cookies.CookieError: continue
            for k, m in jar.items():
                if m.value and m.value != "delete": self.cookies[k] = m.value
                elif k in self.cookies and (m["max-age"] == "0" or m.value == "delete"): del self.cookies[k]

    def get_json(self, path: str, accept: str = "application/graphql") -> Any:
        data, _ = self.request("GET", ORIGIN + path, self.headers(accept))
        return json.loads(data)

    def post_json(self, path: str, payload: Any, accept: str = "application/json", content_type: str = "text/plain;charset=UTF-8") -> Any:
        data, _ = self.request("POST", ORIGIN + path, self.headers(accept, content_type), json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode())
        return json.loads(data) if data.strip() else {}
