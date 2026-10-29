"""A circuit breaker for Gemini billing failures (an account in arrears, a spend cap, no credit left).

Every call would fail the same way and a rate-limit retry costs seconds each, so once one call shows billing
is the problem the breaker trips and calls fail at once with GeminiError(reason "billing_paused") for a
while, with no request made. When the window ends one probe call is let through: if it works the breaker
resets, if billing still fails the window starts again. Callers treat billing_paused like a paused budget:
not the row's fault, so not a try, and nothing fanned out into more calls. Pure and thread safe, with an
injectable clock so it can be unit tested."""

from __future__ import annotations

import threading
import time
from typing import Callable

TRIP_WINDOW_S = 600.0
REASON = "billing_paused"
# Wording that can only mean the account, not the request rate.
STRONG = ("prepayment", "prepaid", "credits", "payment", "past due", "suspended", "spend cap", "spending cap", "billing account", "billing is not", "billing has not", "enable billing")
# A per-minute or per-second limit passes by itself, whatever else the message says about the plan.
RATE_WORDS = ("per minute", "perminute", "per second", "persecond", "requests per", "rate limit", "try again in", "retry in")


def is_billing_error(status: int | None, reason: str = "", detail: str = "") -> bool:
    """True when a Gemini failure is about billing or permission on the account rather than the request.
    status is the HTTP code, reason Google's status string (RESOURCE_EXHAUSTED), detail its message."""
    if status in (402, 403):
        return True
    text = f"{reason} {detail}".lower()
    if "permission_denied" in text:
        return True
    if status not in (429, 400):
        return False
    if any(w in text for w in STRONG):
        return True
    if "billing" in text:  # "check your plan and billing details" is on ordinary quota errors too
        return not any(w in text for w in RATE_WORDS)
    return False


def is_billing_paused(err: BaseException) -> bool:
    """True for the GeminiError a tripped breaker (or the call that tripped it) raises."""
    return REASON in str(err)


class Breaker:
    def __init__(self, window_s: float = TRIP_WINDOW_S, clock: Callable[[], float] = time.monotonic):
        self._window = window_s
        self._clock = clock
        self._lock = threading.Lock()
        self._until: float | None = None  # None: closed. Otherwise calls are refused until then
        self._probing = False

    @property
    def tripped(self) -> bool:
        with self._lock:
            return self._until is not None

    def allow(self) -> bool:
        """Whether a call may go ahead. While tripped, only one probe at a time, and only once the window has ended."""
        with self._lock:
            if self._until is None:
                return True
            if self._clock() < self._until or self._probing:
                return False
            self._probing = True
            return True

    def trip(self) -> bool:
        """Records a billing failure and opens the window again. True when it was closed before: the moment to log."""
        with self._lock:
            fresh = self._until is None
            self._until = self._clock() + self._window
            self._probing = False
            return fresh

    def success(self) -> bool:
        """Records a call that worked. True when that closed a tripped breaker: the moment to log recovery."""
        with self._lock:
            was = self._until is not None
            self._until = None
            self._probing = False
            return was

    def release(self) -> None:
        """A probe that failed for another reason: the next caller may probe, the breaker stays tripped."""
        with self._lock:
            self._probing = False
