"""A circuit breaker for Gemini billing failures (an account in arrears, a spend cap, no credit left).

Every call would fail the same way and a rate-limit retry costs seconds each, so once one call shows billing
is the problem the breaker trips and calls fail at once with GeminiError(reason "billing_paused") for a
while, with no request made. When the window ends one probe call is let through: if it works the breaker
resets, if billing still fails the window starts again. Callers treat billing_paused like a paused budget:
not the row's fault, so not a try, and nothing fanned out into more calls. Pure and thread safe, with an
injectable clock so it can be unit tested. A tripped or recovered breaker is also reported through on_change, which
persist_to turns into a row in ai_status so Admin can show it."""

from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
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
    if status == 402:
        return True
    text = f"{reason} {detail}".lower()
    if status == 403 or "permission_denied" in text:
        # A 403 is also "no access to this file" or "cachedContents/x not found or not permitted", which is about one
        # request and must not stop every user's calls for the window. Only wording about the account counts.
        return any(w in text for w in STRONG) or "billing" in text
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


NOTIFY_EVERY_S = 60.0  # a probe that fails again, or calls in flight when it tripped, must not each write a row


def persist_to(db) -> Callable[[bool, str | None], None]:
    """An on_change callback that writes the breaker state to ai_status (one row, id true). Admin shows a pause when
    billing_checked_at is recent, so a worker that died while tripped stops showing as paused. Never raises: a
    failed write must not turn a billing pause into a crash."""

    def write(paused: bool, since: str | None) -> None:
        now = datetime.now(timezone.utc).isoformat()
        row = {"id": True, "billing_paused_since": since if paused else None, "billing_checked_at": now if paused else None, "updated_at": now}
        try:
            db.upsert("ai_status", row, on_conflict="id")
        except Exception:
            pass

    return write


def persist_unpriced(db, models: list[str]) -> None:
    """Writes the configured models that have no price to ai_status, so Admin can raise an alert. Never raises: the worker
    starts either way (and the models are billed at the dearest known price, see pricing.py)."""
    now = datetime.now(timezone.utc).isoformat()
    try:
        db.upsert("ai_status", {"id": True, "unpriced_models": sorted(set(models)), "updated_at": now}, on_conflict="id")
    except Exception:
        pass


class Breaker:
    def __init__(self, window_s: float = TRIP_WINDOW_S, clock: Callable[[], float] = time.monotonic, on_change: Callable[[bool, str | None], None] | None = None):
        self._window = window_s
        self._clock = clock
        self._on_change = on_change
        self._since: str | None = None  # wall-clock time of the first trip of this pause, for on_change
        self._notified: float | None = None
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

    def blocked(self) -> bool:
        """Whether a call would be refused right now, without taking the probe slot (allow does). For work that would
        download or upload something before its call: it can wait instead of repeating that every window."""
        with self._lock:
            return self._until is not None and (self._clock() < self._until or self._probing)

    def _notify(self, paused: bool, since: str | None) -> None:
        if self._on_change is not None:
            try:
                self._on_change(paused, since)
            except Exception:
                pass

    def trip(self) -> bool:
        """Records a billing failure and opens the window again. True when it was closed before: the moment to log."""
        with self._lock:
            fresh = self._until is None
            now = self._clock()
            self._until = now + self._window
            self._probing = False
            if fresh:
                self._since = datetime.now(timezone.utc).isoformat()
            send = fresh or self._notified is None or now - self._notified >= NOTIFY_EVERY_S
            if send:
                self._notified = now
            since = self._since
        if send:
            self._notify(True, since)
        return fresh

    def success(self) -> bool:
        """Records a call that worked. True when that closed a tripped breaker: the moment to log recovery."""
        with self._lock:
            was = self._until is not None
            self._until = None
            self._probing = False
            self._since = None
            self._notified = None
        if was:
            self._notify(False, None)
        return was

    def release(self) -> None:
        """A probe that failed for another reason: the next caller may probe, the breaker stays tripped."""
        with self._lock:
            self._probing = False
