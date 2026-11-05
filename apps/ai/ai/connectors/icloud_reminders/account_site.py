"""Making an app-specific password for the person, from one Apple ID sign-in, the way account.apple.com does.

Apple has no public way to do this, so it follows the account page's own calls (read from its JavaScript,
2 November 2026; nobody has published them):

  sign in    idmsa.apple.com/appleauth, the same SRP and two-factor steps as iCloud.com, with the account page's
             widget key (ACCOUNT_WIDGET_KEY, from account.apple.com/bootstrap/portal) instead of iCloud's
  open       GET  appleid.apple.com/account/manage/gs/ws/token, with the scnt the account page hands out
  make       POST appleid.apple.com/account/manage/security/secondary-password  {"description": "Konva"}
  recheck    when that answers 451, POST /authenticate/password {"password": ...} and make it again

The sign-in reuses pyicloud's (PyiCloudService, with the iCloud parts swapped for the account page's), so
signin.sign_in drives it unchanged and the codes are asked for in the app as for Reminders. Mail and Calendar
then use the new password over IMAP and CalDAV, which Apple supports, and this session is thrown away.

Kept free of pyicloud at import (the service class is built on first use), so the tests run without it.
Nothing here logs a password, a code, a cookie or a token."""

from __future__ import annotations

import re
from typing import Any, Callable, Protocol

ACCOUNT_WIDGET_KEY = "af1139274f266b22b68c2a3e7ad932cb3c0bbe854e13a79af78dcc73136882c3"
ACCOUNT_PAGE = "https://account.apple.com"
ACCOUNT_API = "https://appleid.apple.com"
TOKEN_PATH = "/account/manage/gs/ws/token"
PASSWORDS_PATH = "/account/manage/security/secondary-password"
RECHECK_PATH = "/authenticate/password"
LABEL = "Konva"

PASSWORD_RECHECK = 451  # Apple's TwoStepAuthenticationRequired: type the password again first
NOT_ON_THE_WEB = 466  # NativeTakeoverForbiddenAppPasswordGeneration: only on an Apple device for this Apple ID

APP_PASSWORD = re.compile(r"^[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}$")
SCNT = re.compile(r'"scnt"\s*:\s*"([^"]+)"')

FAILED = {
    "not_on_the_web": "Apple only makes app-specific passwords for this Apple ID on an Apple device. Make one there, then choose Use an App-Specific Password Instead.",
    "no_app_passwords": "This Apple ID cannot have app-specific passwords, which work accounts often cannot. Choose Use an App-Specific Password Instead, or use a personal Apple ID.",
    "untrusted": "Apple did not let Konva open your Apple Account. Wait a while, then connect again.",
    "other": "Apple did not make the app-specific password. Wait a while, then connect again.",
}


class AppPasswordFailed(Exception):
    def __init__(self, code: str, status: int | None = None):
        super().__init__(code)
        self.code = code  # a FAILED key, for logs and analytics
        self.detail = FAILED[code]
        self.status = status  # Apple's HTTP status, for the log


class Reply(Protocol):
    status_code: int
    headers: Any
    text: str

    def json(self) -> Any: ...


Send = Callable[..., Reply]  # (method, url, *, headers, json=None) -> Reply, with the signed-in cookies


def find_app_password(data: Any) -> str | None:
    """The new password in Apple's answer: under "password" when it is there, else the first value shaped like
    one (four groups of four letters), so a renamed field still works."""
    if isinstance(data, dict):
        named = data.get("password")
        if isinstance(named, str) and APP_PASSWORD.match(named.strip()):
            return named.strip()
        values: list[Any] = list(data.values())
    elif isinstance(data, list):
        values = list(data)
    else:
        return data.strip() if isinstance(data, str) and APP_PASSWORD.match(data.strip()) else None
    for value in values:
        found = find_app_password(value)
        if found:
            return found
    return None


class AccountSite:
    """The account page's API, on the cookies the sign-in left. send is requests.Session.request on the
    signed-in session (not pyicloud's own request, which would treat Apple's answers as iCloud's)."""

    def __init__(self, send: Send, fd_client_info: str = ""):
        self.send = send
        self.fd_client_info = fd_client_info
        self.scnt: str | None = None

    def _headers(self) -> dict[str, str]:
        headers = {
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json",
            "Origin": ACCOUNT_PAGE,
            "Referer": f"{ACCOUNT_PAGE}/",
            "X-Apple-I-Request-Context": "ca",
        }
        if self.fd_client_info:
            headers["X-Apple-I-FD-Client-Info"] = self.fd_client_info
        if self.scnt:
            headers["scnt"] = self.scnt
        return headers

    def _call(self, method: str, path: str, body: Any = None) -> Reply:
        reply = self.send(method, f"{ACCOUNT_API}{path}", headers=self._headers(), json=body)
        scnt = reply.headers.get("scnt") if reply.headers else None
        if scnt:
            self.scnt = scnt  # the account page replays the latest one on every call
        return reply

    def open(self) -> None:
        """What the account page does on load: its HTML hands out the first scnt, then the token call opens
        the session. Raises AppPasswordFailed("untrusted") when Apple does not take the sign-in here."""
        page = self.send("GET", f"{ACCOUNT_PAGE}/account/manage", headers={"Accept": "text/html"})
        found = SCNT.search(page.text or "") if page.status_code == 200 else None
        if found:
            self.scnt = found.group(1)
        reply = self._call("GET", TOKEN_PATH)
        if reply.status_code != 200:
            raise AppPasswordFailed("untrusted", reply.status_code)

    def make(self, password: str, label: str = LABEL) -> str:
        """A new app-specific password, labelled as it shows in the person's Apple Account. When Apple asks for
        the password again first (451), it is given once and the call made again."""
        reply = self._call("POST", PASSWORDS_PATH, {"description": label})
        if reply.status_code == PASSWORD_RECHECK:
            check = self._call("POST", RECHECK_PATH, {"password": password})
            if check.status_code not in (200, 204):
                raise AppPasswordFailed("untrusted", check.status_code)
            reply = self._call("POST", PASSWORDS_PATH, {"description": label})
        if reply.status_code == NOT_ON_THE_WEB:
            raise AppPasswordFailed("not_on_the_web", reply.status_code)
        if reply.status_code in (401, 403):
            raise AppPasswordFailed("untrusted", reply.status_code)
        if reply.status_code == 400:
            raise AppPasswordFailed("no_app_passwords", reply.status_code)
        if reply.status_code != 200:
            raise AppPasswordFailed("other", reply.status_code)
        try:
            data = reply.json()
        except Exception:
            raise AppPasswordFailed("other") from None
        found = find_app_password(data)
        if not found:
            raise AppPasswordFailed("other")
        return found


def make_account_api(apple_id: str, password: str, cookie_directory: str) -> Any:
    """A pyicloud client that signs in to account.apple.com instead of iCloud.com, having made no request yet.
    signin.sign_in drives it as it does the iCloud one: authenticate, the code, trust."""
    from pyicloud import PyiCloudService
    from pyicloud.exceptions import PyiCloudFailedLoginException

    from .client import _silence

    class AccountService(PyiCloudService):
        """PyiCloudService with the account page's widget key and, in place of iCloud's accountLogin (which
        this sign-in has no use for), opening the account page. Only these two points differ."""

        site: AccountSite | None = None
        # Why the account page refused the session, once the password and code were taken. sign_in only sees
        # pyicloud's failed login, which it reads as the password; run_setup reports this instead.
        refused: AppPasswordFailed | None = None
        _srp_done = False

        def _setup_endpoints(self) -> None:
            super()._setup_endpoints()
            self._home_endpoint = ACCOUNT_PAGE

        def _get_auth_headers(self, overrides: dict[str, Any] | None = None) -> dict[str, Any]:
            headers = super()._get_auth_headers(overrides)
            headers["X-Apple-Widget-Key"] = ACCOUNT_WIDGET_KEY
            headers["X-Apple-OAuth-Client-Id"] = ACCOUNT_WIDGET_KEY
            headers["X-Apple-OAuth-Redirect-URI"] = ACCOUNT_PAGE
            return headers

        def _srp_authentication(self, pause_2fa: bool = False) -> bool:
            done = super()._srp_authentication(pause_2fa)
            self._srp_done = True
            return done

        def _authenticate_with_token(self, require_trust: bool = True) -> None:
            if not self._srp_done:  # before the password is sent there is nothing to open
                raise PyiCloudFailedLoginException("Not signed in yet")
            import requests

            session = self.session
            headers = self._get_auth_headers()
            self.site = AccountSite(lambda method, url, **kw: requests.Session.request(session, method, url, timeout=30, **kw), headers.get("X-Apple-FD-Client-Info", ""))
            try:
                self.site.open()
            except AppPasswordFailed as err:
                self.refused = err
                raise PyiCloudFailedLoginException("Account page refused the sign-in") from err
            self.data = {"hsaTrustedBrowser": True, "dsInfo": {"hsaVersion": 2}}

    _silence()
    return AccountService(apple_id, password, cookie_directory=cookie_directory, authenticate=False, with_family=False, refresh_interval=None)


def trust_token(api: Any) -> str | None:
    """The token that lets a later sign-in on this Apple ID skip the code, when Apple gave one."""
    try:
        token = api.session.data.get("trust_token")
    except Exception:
        return None
    return str(token) if token else None
