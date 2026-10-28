"""Signing in to Instagram once, with the codes it may ask for on the way, typed in the app.

instagrapi asks for a code in two ways. A challenge (Instagram is not sure it is you) calls the client's
challenge_code_handler with where it sent the code, email or SMS, and expects the code back from that
call, so the handler waits here for the app to hand it over. Two-factor authentication raises
TwoFactorRequired instead, and login is called again with the code. Either way the step is written to
public.instagram_sign_ins, the app shows "Enter the Code Instagram Sent You", and the code comes back the
same way. Nothing here logs a code, a password or anything from the session.

Kept free of instagrapi itself (errors are told apart by name, as in backoff), so the flow is unit tested
with a stand-in client."""

from __future__ import annotations

import threading
import time
from typing import Any, Callable, Protocol

from .backoff import kind_of

CODE_WAIT_S = 10 * 60.0  # how long a code is waited for before the sign-in gives up
CODE_POLL_S = 3.0
TWO_FACTOR_TRIES = 3

FAILED = {
    "timeout": "The code was not entered within 10 minutes. Connect again to get a new one.",
    "wrong_code": "Instagram did not accept the code. Connect again to get a new one.",
    "challenge": "Instagram wants to confirm this sign-in in a way Konva cannot show. Open the Instagram app, confirm it was you, then connect again.",
    "bad_password": "Instagram did not accept that username and password. Check them and connect again.",
    "banned": "Instagram has suspended or disabled this account. Open the Instagram app to see why.",
    "rate": "Instagram is limiting sign-ins right now. Wait an hour, then connect again.",
    "feedback": "Instagram is limiting sign-ins right now. Wait an hour, then connect again.",
    "blocked_ip": "Instagram blocked sign-ins from this server's internet address. This needs a fix on Konva's side. Try connecting again later.",
    "network": "Could not reach Instagram. Connect again in a few minutes.",
    "login": "Instagram did not let Konva sign in. Wait a while, then connect again.",
    "other": "Instagram did not let Konva sign in. Wait a while, then connect again.",
}


class SignInFailed(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code  # a FAILED key, for logs and analytics
        self.detail = FAILED[code]


class SignInStopped(Exception):
    """The account was paused or connected again while the sign-in waited for a code."""


class Codes(Protocol):
    """Where a sign-in asks for a code and gets it back (store.SignInRow)."""

    def ask(self, step: str, method: str | None, attempt: int) -> None: ...
    def take(self) -> str | None: ...
    def done(self) -> None: ...


class CodeWait:
    """Asks the app for a code and waits for it. Also the client's challenge_code_handler."""

    def __init__(
        self,
        codes: Codes,
        stop: threading.Event,
        *,
        wait_s: float = CODE_WAIT_S,
        poll_s: float = CODE_POLL_S,
        now: Callable[[], float] = time.monotonic,
    ):
        self.codes = codes
        self.stop = stop
        self.wait_s = wait_s
        self.poll_s = poll_s
        self.now = now
        self.asked: dict[str, int] = {}
        self.timed_out = False

    def __call__(self, username: str, choice: Any) -> str:
        # instagrapi's ChallengeChoice: SMS or EMAIL.
        name = str(getattr(choice, "name", choice)).upper()
        return self.wait("code", "sms" if "SMS" in name else "email")

    def wait(self, step: str, method: str | None) -> str:
        """The code typed in the app for this step, or "" when none came in time."""
        self.asked[step] = self.asked.get(step, 0) + 1
        self.codes.ask(step, method, self.asked[step])
        deadline = self.now() + self.wait_s
        while self.now() < deadline:
            if self.stop.is_set():
                raise SignInStopped()
            code = (self.codes.take() or "").strip().replace(" ", "")
            if code:
                return code
            self.stop.wait(self.poll_s)
        self.timed_out = True
        return ""


def two_factor_method(data: Any) -> str | None:
    """Where a two-factor code comes from, from the login response: an authenticator app or SMS."""
    found: dict[str, Any] = {}

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                if key in ("totp_two_factor_on", "sms_two_factor_on", "whatsapp_two_factor_on") and key not in found:
                    found[key] = value
                walk(value)
        elif isinstance(node, list):
            for child in node:
                walk(child)

    walk(data)
    on = {k for k, v in found.items() if v in (True, 1, "1", "true", "True")}
    if "totp_two_factor_on" in on:
        return "app"
    if "sms_two_factor_on" in on:
        return "sms"
    return None


def sign_in(client: Any, username: str, password: str, codes: Codes, stop: threading.Event, **wait: Any) -> None:
    """Signs the client in, asking for codes as needed. Raises SignInFailed with a plain reason, or
    SignInStopped. The session is the client's own afterwards (get_settings)."""
    waiter = CodeWait(codes, stop, **wait)
    client.challenge_code_handler = waiter
    client.change_password_handler = lambda _username: None  # a forced password change is done in the app
    client.with_challenge_flow = True
    try:
        try:
            client.login(username, password)
        except SignInStopped:
            raise
        except Exception as err:
            if kind_of(err) != "two_factor":
                raise
            method = two_factor_method(getattr(client, "last_json", None))
            for attempt in range(1, TWO_FACTOR_TRIES + 1):
                code = waiter.wait("two_factor", method)
                if not code:
                    raise SignInFailed("timeout")
                try:
                    client.login(username, password, verification_code=code)
                    break
                except SignInStopped:
                    raise
                except Exception as again:
                    # A wrong code comes back as another request for one, or as a plain error.
                    if kind_of(again) not in ("two_factor", "other"):
                        raise
                    if attempt == TWO_FACTOR_TRIES:
                        raise SignInFailed("wrong_code") from None
    except (SignInFailed, SignInStopped):
        raise
    except Exception as err:
        if waiter.timed_out:
            raise SignInFailed("timeout") from None
        kind = kind_of(err)
        if kind == "challenge" and waiter.asked.get("code", 0) > 1:
            raise SignInFailed("wrong_code") from None
        raise SignInFailed(kind if kind in FAILED else "other") from None
    finally:
        client.with_challenge_flow = False  # from now on a challenge stops the account instead
        codes.done()
