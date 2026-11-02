"""Instagram's official API (Instagram API with Instagram Login) over plain HTTPS, with nothing but the
standard library, so a Business or Creator account needs no instagrapi.

Calls go to graph.instagram.com with the account's access token in an Authorization header, never in the
address, so a token cannot end up in a proxy or access log. Meta's error JSON is read for its numeric code
and subcode only; its message is never kept or logged. Errors are told apart by a `kind` that backoff.kind_of
reads (login, permission, rate, feedback, network, other), so the sync loop treats them like instagrapi's.

The HTTP call itself is one small function, `open_url`, so tests hand in their own."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

from ...tls import CONTEXT

HOST = "https://graph.instagram.com"
VERSION = "v25.0"  # Meta supports a version for about two years; move it deliberately, after reading the changelog
TIMEOUT_S = 30

# Meta's error codes (developers.facebook.com/docs/graph-api/guides/error-handling).
LOGIN = {190, 102}  # the token expired, was revoked, or the person signed out of Instagram everywhere
PERMISSION = {10, 200, 230, 299}
RATE = {4, 17, 32, 613, 80002, 80006, 80008, 80009}
FEEDBACK = {368}  # temporarily blocked for a policy violation
INVALID_FIELD = 100  # also "Tried accessing nonexisting field"
OUTSIDE_WINDOW = 2534022  # error_subcode of code 10 when a reply is more than 24 hours after their last message


class GraphError(Exception):
    """A refusal or failure from the API, by number only (code is what logs show)."""

    def __init__(self, status: int, code: int | None, subcode: int | None, kind: str, ambiguous: bool = False):
        super().__init__(f"instagram api error {status} {code} {subcode}")
        self.status = status
        self.graph_code = code
        self.subcode = subcode
        self.kind = kind
        # True when the request may have been taken before the answer was lost: a timeout, a dropped connection, a 5xx.
        self.ambiguous = ambiguous
        self.code = f"graph_{code}" if code else f"http_{status}"

    @property
    def outside_window(self) -> bool:
        return self.subcode == OUTSIDE_WINDOW

    @property
    def invalid_field(self) -> bool:
        return self.graph_code == INVALID_FIELD


def classify(status: int, code: int | None, subcode: int | None) -> str:
    if subcode == OUTSIDE_WINDOW:
        return "other"  # a reply refused, not an account problem; send() tells it by outside_window
    if code in LOGIN or status == 401:
        return "login"
    if code in PERMISSION or status == 403:
        return "permission"
    if code in RATE or status == 429:
        return "rate"
    if code in FEEDBACK:
        return "feedback"
    return "other"


def open_url(request: urllib.request.Request) -> tuple[int, bytes]:
    """The real HTTP call: (status, body), for any status."""
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S, context=CONTEXT) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()


class Graph:
    def __init__(self, token: str, open_: Callable[[urllib.request.Request], tuple[int, bytes]] = open_url, version: str = VERSION):
        self.token = token
        self.open = open_
        self.version = version

    def call(self, method: str, path: str, params: dict[str, Any] | None = None, body: dict[str, Any] | None = None, *, versioned: bool = True) -> dict[str, Any]:
        """One request. `path` is "/me/conversations" or an ID."""
        url = f"{HOST}/{self.version}{path}" if versioned else f"{HOST}{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        data = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {"Authorization": f"Bearer {self.token}", "Accept": "application/json"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            status, raw = self.open(request)
        except (OSError, ValueError) as err:  # URLError, timeouts and dropped connections are all OSError
            raise GraphError(0, None, None, "network", ambiguous=True) from err
        try:
            parsed = json.loads(raw.decode("utf-8")) if raw else {}
        except ValueError:
            parsed = {}
        if status >= 400 or (isinstance(parsed, dict) and parsed.get("error")):
            err = (parsed.get("error") if isinstance(parsed, dict) else None) or {}
            code = err.get("code") if isinstance(err.get("code"), int) else None
            subcode = err.get("error_subcode") if isinstance(err.get("error_subcode"), int) else None
            kind = "network" if status >= 500 else classify(status, code, subcode)
            raise GraphError(status, code, subcode, kind, ambiguous=status >= 500)
        return parsed if isinstance(parsed, dict) else {}

    # -- the calls Konva makes ----------------------------------------------------------------------------

    def me(self) -> dict[str, Any]:
        """The signed-in professional account: user_id (the ID messages carry), username, account_type."""
        return self.call("GET", "/me", {"fields": "user_id,username,account_type"})

    def conversations(self, limit: int = 20, after: str | None = None) -> dict[str, Any]:
        params = {"platform": "instagram", "fields": "id,updated_time,participants", "limit": str(limit)}
        if after:
            params["after"] = after
        return self.call("GET", "/me/conversations", params)

    def messages(self, conversation_id: str, fields: str, limit: int = 20) -> dict[str, Any]:
        """A conversation's newest messages, expanded in one request. Instagram only lets the 20 newest be read."""
        return self.call("GET", f"/{conversation_id}", {"fields": f"messages.limit({limit}){{{fields}}}"})

    def profile(self, igsid: str) -> dict[str, Any]:
        return self.call("GET", f"/{igsid}", {"fields": "name,username"})

    def send(self, recipient: str, text: str, human_agent: bool = False) -> dict[str, Any]:
        """POST /me/messages: a text reply to someone who messaged within the last 24 hours, or with human_agent
        up to 7 days after (messaging_type MESSAGE_TAG and the HUMAN_AGENT tag; only for a reply a person wrote)."""
        body: dict[str, Any] = {"recipient": {"id": recipient}, "message": {"text": text}}
        if human_agent:
            body.update({"messaging_type": "MESSAGE_TAG", "tag": "HUMAN_AGENT"})
        return self.call("POST", "/me/messages", body=body)

    def refresh(self) -> dict[str, Any]:
        """Swaps this long-lived token for a fresh one of 60 days. Needs a token at least a day old that has not
        expired. Meta documents this one with the token as a parameter, so it is the only call that has it in the address."""
        return self.call("GET", "/refresh_access_token", {"grant_type": "ig_refresh_token", "access_token": self.token}, versioned=False)
