"""Signing in to iCloud once, with what Apple asks for on the way, typed in the app.

pyicloud signs in with SRP (authenticate) and, for an Apple ID with two-factor authentication, which is
every Apple ID now, has already asked Apple to prompt the person's devices by the time it returns. The code
comes back from the app the way Instagram's does: the step is written to public.instagram_sign_ins (the one
table for sign-in steps, so there is no new schema), the app shows it, and what the person types comes back
sealed in the same row. Besides a code the app can send two signals: "sms" (Send a Text Instead) and
"continue" (Advanced Data Protection: they have turned on Access iCloud Data on the Web and are ready to
approve on their device).

  step two_factor, method app   the 6-digit code shown on an Apple device (also the Send a Text Instead button)
  step two_factor, method sms   the 6-digit code texted to their trusted phone number
  step code,       method app   Advanced Data Protection: turn on web access on the iPhone, approve, continue

Kept free of pyicloud itself (errors are told apart by name, as in backoff), so the flow is unit tested with
a stand-in client. Nothing here logs a code, a password or anything from the session."""

from __future__ import annotations

import threading
import time
from typing import Any, Callable, Protocol

from .backoff import kind_of
from .client import can_send_sms, consent_needed, send_sms

CODE_WAIT_S = 10 * 60.0  # how long a code is waited for before the sign-in gives up
CODE_POLL_S = 3.0
CODE_TRIES = 3
ACCESS_TRIES = 3
SMS = "sms"  # what the app sends for Send a Text Instead
CONTINUE = "continue"  # what the app sends once web access is on and the person is ready to approve

FAILED = {
    "timeout": "The code was not entered within 10 minutes. Connect again to get a new one.",
    "wrong_code": "Apple did not accept the code. Connect again to get a new one.",
    "bad_password": "Apple did not accept that Apple ID and password. Check them and connect again.",
    "locked": "Apple has locked this Apple ID for security. Unlock it at iforgot.apple.com, then connect again.",
    "terms": "Apple has updated its iCloud terms. Sign in at icloud.com once and accept them, then connect again.",
    "security_key": "This Apple ID signs in with a security key, which Konva cannot use. Turn that off in your Apple ID settings, or use a different Apple ID.",
    "untrusted": "Apple did not trust this sign-in. Connect again.",
    "web_access": "iCloud would not share Reminders with the web. On your iPhone, turn on Access iCloud Data on the Web, then connect again.",
    "not_set_up": "Reminders is not set up in iCloud for this Apple ID. Open Reminders on your iPhone once, then connect again.",
    "rate": "Apple is limiting sign-ins right now. Wait an hour, then connect again.",
    "network": "Could not reach iCloud. Connect again in a few minutes.",
    "other": "iCloud did not let Konva sign in. Wait a while, then connect again.",
}


class SignInFailed(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code  # a FAILED key, for logs and analytics
        self.detail = FAILED[code]


class SignInStopped(Exception):
    """The account was paused or connected again while the sign-in waited."""


class Codes(Protocol):
    """Where a sign-in asks for a code and gets it back (store.SignInRow)."""

    def ask(self, step: str, method: str | None, attempt: int, note: str | None = None) -> None: ...
    def take(self) -> str | None: ...
    def waiting(self, detail: str) -> None: ...
    def done(self) -> None: ...


class CodeWait:
    """Asks the app for the person's answer to a step and waits for it."""

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
        self.asked = 0

    def wait(self, step: str, method: str | None, note: str | None = None) -> str:
        """What the app handed back for this step: digits, "sms" or "continue", else "" when none came in time."""
        self.asked += 1
        self.codes.ask(step, method, self.asked, note)
        deadline = self.now() + self.wait_s
        while self.now() < deadline:
            if self.stop.is_set():
                raise SignInStopped()
            answer = (self.codes.take() or "").strip().replace(" ", "").lower()
            if answer:
                return answer
            self.stop.wait(self.poll_s)
        return ""


def failed_from(err: BaseException, password: bool = True) -> SignInFailed:
    """The plain reason an error from signing in means. password: a refused login is taken to be the password."""
    kind = kind_of(err)
    if kind == "expired":
        kind = "bad_password" if password else "other"
    return SignInFailed(kind if kind in FAILED else "other")


def _two_factor(api: Any, waiter: CodeWait) -> None:
    delivery = getattr(api, "two_factor_delivery_method", "unknown")
    if delivery == "security_key":
        raise SignInFailed("security_key")
    by_text = delivery == "sms"
    note: str | None = None
    wrong = 0
    while wrong < CODE_TRIES:
        answer = waiter.wait("two_factor", "sms" if by_text else "app", note)
        note = None
        if not answer:
            raise SignInFailed("timeout")
        if answer == SMS:
            if by_text:
                continue
            if can_send_sms(api):
                try:
                    send_sms(api)
                    by_text = True
                    continue
                except Exception as err:
                    if kind_of(err) == "network":
                        raise failed_from(err) from err
            note = "texts"
            continue
        if not answer.isdigit():
            continue
        try:
            ok = bool(api.validate_2fa_code(answer))
        except SignInStopped:
            raise
        except Exception as err:
            raise failed_from(err) from err
        if ok or getattr(api, "is_trusted_session", False):
            return
        wrong += 1
        note = "wrong"
    raise SignInFailed("wrong_code")


def _two_step(api: Any, waiter: CodeWait) -> None:
    """Apple's older two-step verification, for an Apple ID that never moved to two-factor."""
    devices = list(api.trusted_devices or [])
    if not devices:
        raise SignInFailed("other")
    device = next((d for d in devices if d.get("phoneNumber")), devices[0])
    if not api.send_verification_code(device):
        raise SignInFailed("other")
    for _ in range(CODE_TRIES):
        answer = waiter.wait("two_factor", "sms")
        if not answer:
            raise SignInFailed("timeout")
        if answer.isdigit() and api.validate_verification_code(device, answer):
            return
    raise SignInFailed("wrong_code")


def sign_in(api: Any, codes: Codes, stop: threading.Event, **wait: Any) -> CodeWait:
    """Signs the client in with the password it was made with, asking for codes as needed. Raises
    SignInFailed with a plain reason, or SignInStopped. Returns the waiter, so opening Reminders can carry on
    asking in the same sign-in. The session is the client's own afterwards."""
    waiter = CodeWait(codes, stop, **wait)
    try:
        try:
            api.authenticate()
            if api.requires_2fa:
                _two_factor(api, waiter)
            elif api.requires_2sa:
                _two_step(api, waiter)
            if not getattr(api, "is_trusted_session", False):
                api.trust_session()
            if not getattr(api, "is_trusted_session", False):
                raise SignInFailed("untrusted")
        except (SignInFailed, SignInStopped):
            raise
        except Exception as err:
            raise failed_from(err) from err
    except (SignInFailed, SignInStopped):
        codes.done()
        raise
    return waiter


def open_reminders(api: Any, codes: Codes, waiter: CodeWait) -> Any:
    """pyicloud's RemindersService, once iCloud shares Reminders with the web. With Advanced Data Protection
    on, Apple first asks a trusted device to approve: the person is told how, waits for their go-ahead, and
    pyicloud then asks Apple and waits for the approval (up to a minute and a half). A timeout asks again."""
    needed = consent_needed(api)
    for attempt in range(1, ACCESS_TRIES + 1):
        if needed:
            answer = waiter.wait("code", "app", None if attempt == 1 else "again")
            while answer and answer != CONTINUE:  # anything else typed is not the go-ahead
                answer = waiter.wait("code", "app", None)
            if not answer:
                raise SignInFailed("timeout")
            codes.waiting("Waiting for you to approve on your Apple device.")
        else:
            codes.waiting("Opening Reminders in iCloud.")
        try:
            return api.reminders
        except SignInStopped:
            raise
        except Exception as err:
            if kind_of(err) != "web_access" or attempt == ACCESS_TRIES:
                raise failed_from(err, password=False) from None
            needed = True
    raise SignInFailed("web_access")
