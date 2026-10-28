"""What an iCloud error means and how long to wait, so the account never hammers Apple.

Errors are told apart by pyicloud's exception class names, found by name so this needs no import of
pyicloud and is unit tested with stand-ins (as the Instagram connector's backoff is). A signed-out session,
a locked Apple ID or a Reminders service that is not set up stops the account until the person connects
again; limits and outages back off; anything else backs off gently. Pure, apart from the random jitter it
is given."""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Callable

MINUTE = 60.0
HOUR = 3600.0

POLL_S = 120.0  # delta sync is one small request when nothing changed, so every two minutes
JITTER = 0.2  # each wait is up to a fifth shorter or longer

PCS_ERROR = "Unable to request PCS access!"  # pyicloud's own message when Apple would not ask the device


@dataclass(frozen=True)
class Trouble:
    kind: str  # a code word for logs and analytics
    stop: bool  # stop the account until the person connects again
    first_s: float  # the first wait, doubled on each failure in a row
    max_s: float
    detail: str  # shown in Settings


STOPS = {
    "expired": Trouble("expired", True, 0, 0, "Your iCloud sign-in has ended. Sign in again to keep Reminders syncing."),
    "locked": Trouble("locked", True, 0, 0, "Apple has locked this Apple ID for security. Unlock it at iforgot.apple.com, then connect again."),
    "not_set_up": Trouble("not_set_up", True, 0, 0, "Reminders is not set up in iCloud for this Apple ID. Open Reminders on your iPhone once, then connect again."),
    "terms": Trouble("terms", True, 0, 0, "Apple has updated its iCloud terms. Sign in at icloud.com once and accept them, then connect again."),
    "web_access": Trouble(
        "web_access", True, 0, 0,
        "iCloud would not share Reminders with the web. On your iPhone, turn on Access iCloud Data on the Web, then connect again.",
    ),
}
WAITS = {
    "rate": Trouble("rate", False, 15 * MINUTE, 4 * HOUR, "iCloud asked Konva to slow down. Syncing again shortly."),
    "network": Trouble("network", False, 1 * MINUTE, 30 * MINUTE, "Could not reach iCloud. Trying again shortly."),
    "gone": Trouble("gone", False, 1 * HOUR, 6 * HOUR, "iCloud changed how Reminders is read. Konva will keep trying."),
    "other": Trouble("other", False, 5 * MINUTE, 1 * HOUR, "iCloud returned an error. Trying again shortly."),
}

# pyicloud's exception classes (pyicloud/exceptions.py and services/reminders/client.py), by name.
NAMES: list[tuple[str, set[str]]] = [
    ("locked", {"PyiCloudAccountLockedException"}),
    (
        "expired",
        {
            "PyiCloudFailedLoginException",
            "PyiCloud2FARequiredException",
            "PyiCloud2SARequiredException",
            "PyiCloudAuthRequiredException",
            "RemindersAuthError",
        },
    ),
    ("terms", {"PyiCloudAcceptTermsException"}),
    ("not_set_up", {"PyiCloudServiceNotActivatedException", "PyiCloudServiceUnavailable"}),
    ("web_access", {"PyiCloudPCSTimeoutException"}),
    ("gone", {"PyiCloudEndpointGoneException"}),
    ("network", {"PyiCloudConnectionException", "ConnectionError", "Timeout", "TimeoutError"}),
]


def kind_of(err: BaseException) -> str:
    """What kind of trouble an error is: one of the NAMES kinds, else "rate", "web_access" or "network"
    from what pyicloud says, else "other"."""
    names = {c.__name__ for c in type(err).__mro__}
    for kind, classes in NAMES:
        if names & classes:
            return kind
    if getattr(err, "reason", None) == PCS_ERROR:
        return "web_access"
    status = getattr(getattr(err, "response", None), "status_code", None) or getattr(err, "code", None)
    retry = (getattr(err, "payload", None) or {}).get("retry_after") if isinstance(getattr(err, "payload", None), dict) else None
    if status in (429, 503) or retry is not None:
        return "rate"
    if isinstance(err, OSError):
        return "network"
    return "other"


def trouble(err: BaseException) -> Trouble:
    kind = kind_of(err)
    return STOPS.get(kind) or WAITS[kind]


class Backoff:
    """Waits that double on each failure in a row, with jitter, reset by a success."""

    def __init__(self, rand: Callable[[], float] = random.random):
        self.failures = 0
        self._rand = rand

    def next(self, t: Trouble) -> float:
        self.failures += 1
        wait = min(t.max_s, t.first_s * 2 ** (self.failures - 1))
        return wait * (1 + JITTER * (2 * self._rand() - 1))

    def reset(self) -> None:
        self.failures = 0


def poll_wait(rand: Callable[[], float] = random.random) -> float:
    """Seconds until the next sync."""
    return POLL_S * (1 + JITTER * (2 * rand() - 1))
