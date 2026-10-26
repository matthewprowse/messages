"""How long to wait, and when to stop, so the account looks like a person checking their messages.

Instagram watches for automation, so the inbox is read every few minutes with jitter, and less often
the longer nothing new arrives. Errors are told apart by instagrapi's exception classes, found by name so
this needs no import of instagrapi and is unit tested with stand-ins. A challenge, a sign-out, a ban or a
blocked address stops the account until you connect it again; rate limits and feedback_required back off
hard; anything else backs off gently. Pure, apart from the random jitter it is given."""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Callable

MINUTE = 60.0
HOUR = 3600.0

# The inbox is read this often while a conversation is going, and gradually less when it is quiet.
ACTIVE_S = 3 * MINUTE
QUIET_S = 6 * MINUTE  # after 30 minutes with nothing new
IDLE_S = 12 * MINUTE  # after 2 hours with nothing new
JITTER = 0.25  # each wait is up to a quarter shorter or longer


@dataclass(frozen=True)
class Trouble:
    kind: str  # a code word for logs and analytics
    stop: bool  # stop the account until you connect it again
    first_s: float  # the first wait, doubled on each failure in a row
    max_s: float
    detail: str  # shown in Settings


STOPS = {
    "banned": Trouble("banned", True, 0, 0, "Instagram has suspended or disabled this account. Open the Instagram app to see why."),
    "challenge": Trouble(
        "challenge", True, 0, 0,
        "Instagram wants to check it is you. Open the Instagram app, confirm it was you, then connect again in Settings.",
    ),
    "login": Trouble("login", True, 0, 0, "Instagram signed Konva out. Connect again in Settings."),
    "bad_password": Trouble("bad_password", True, 0, 0, "Instagram did not accept that username and password. Check them and connect again."),
    "blocked_ip": Trouble(
        "blocked_ip", True, 0, 0,
        "Instagram blocked this server's internet address. Set INSTAGRAM_PROXY to a home or mobile proxy, then connect again.",
    ),
}
WAITS = {
    "rate": Trouble("rate", False, 15 * MINUTE, 4 * HOUR, "Instagram asked Konva to slow down. Syncing again shortly."),
    "feedback": Trouble("feedback", False, 6 * HOUR, 24 * HOUR, "Instagram limited this account for a while. Syncing again in a few hours."),
    "network": Trouble("network", False, 1 * MINUTE, 30 * MINUTE, "Could not reach Instagram. Trying again shortly."),
    "other": Trouble("other", False, 5 * MINUTE, 1 * HOUR, "Instagram returned an error. Trying again shortly."),
}

# instagrapi's exception classes (instagrapi/exceptions.py), by name, most telling first.
NAMES: list[tuple[str, set[str]]] = [
    ("banned", {"AccountSuspended"}),
    ("two_factor", {"TwoFactorRequired"}),
    ("challenge", {"ChallengeError", "ChallengeRequired", "CaptchaChallengeRequired", "RelatedProfileRequired"}),
    ("login", {"LoginRequired", "ClientLoginRequired", "ReloginAttemptExceeded"}),
    ("bad_password", {"BadPassword", "BadCredentials"}),
    ("blocked_ip", {"ProxyAddressIsBlocked"}),
    ("feedback", {"FeedbackRequired", "SentryBlock"}),
    ("rate", {"PleaseWaitFewMinutes", "ClientThrottledError", "RateLimitError"}),
    ("network", {"ClientConnectionError", "ClientRequestTimeout", "ClientIncompleteReadError", "ConnectionError", "TimeoutError", "Timeout", "ProxyError", "SSLError"}),
]


def kind_of(err: BaseException) -> str:
    """What kind of trouble an error is: one of the NAMES kinds, else "network" for OS errors and "other"."""
    names = {c.__name__ for c in type(err).__mro__}
    for kind, classes in NAMES:
        if names & classes:
            return kind
    status = getattr(getattr(err, "response", None), "status_code", None) or getattr(err, "code", None)
    if status == 429:
        return "rate"
    if isinstance(err, OSError):
        return "network"
    return "other"


def trouble(err: BaseException) -> Trouble:
    kind = kind_of(err)
    if kind == "two_factor":  # outside a sign-in, a request for a code means signing in again
        kind = "login"
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


def poll_wait(quiet_s: float, rand: Callable[[], float] = random.random) -> float:
    """Seconds until the next inbox read, given how long nothing new has arrived."""
    base = ACTIVE_S if quiet_s < 30 * MINUTE else QUIET_S if quiet_s < 2 * HOUR else IDLE_S
    return base * (1 + JITTER * (2 * rand() - 1))
