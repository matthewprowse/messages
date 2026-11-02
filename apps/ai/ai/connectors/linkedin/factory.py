"""The real client: opens a session from cookies by asking LinkedIn who they belong to. The password sign-in is not
here yet (it needs LinkedIn's sign-in request, which carries a browser fingerprint the helper cannot yet make), so it
answers `unsupported` and the worker keeps the sign-in on the Go helper."""

from __future__ import annotations

import json
from typing import Callable, Optional

from . import mapping
from .api import VoyagerApi
from .client import Api, SignedIn
from .session import Session
from .wire import SignInError, UNSUPPORTED


class VoyagerFactory:
    def __init__(self, opener: Optional[Callable] = None) -> None: self.opener = opener

    def password_login(self, email: str, password: str, proxy: str) -> SignedIn:
        raise SignInError(UNSUPPORTED, stage="password")

    def open(self, cookies: str, headers: dict, page_instance: str, x_li_track: str, sync_token: str) -> tuple[dict, Api]:
        s = Session(cookies, headers, page_instance, x_li_track, self.opener)
        data, _ = s.request("GET", "https://www.linkedin.com/voyager/api/me", s.headers("application/vnd.linkedin.normalized+json+2.1"))
        me = mapping.me_from(json.loads(data))
        return me, VoyagerApi(s, me, sync_token)
