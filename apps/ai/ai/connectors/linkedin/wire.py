"""The helper's wire format: error kinds, the response shapes, and how an exception becomes an error kind.

Pure. An error never carries what LinkedIn said, only the HTTP status when there was one and, for a
sign-in, a fixed label for the step it failed at."""

from __future__ import annotations

from typing import Any

BAD_CREDENTIALS = "bad_credentials"  # the session is no longer valid: reconnect
RATE_LIMITED = "rate_limited"  # 429: slow down
REFUSED = "refused"  # 999: LinkedIn refused the request
FORBIDDEN = "forbidden"  # 403: not allowed, or the account is restricted
BAD_REQUEST = "bad_request"  # a command the worker should not have sent
FAILED = "failed"  # anything else
PARTIAL = "partial"  # a send of several files that stopped part way
NOT_FOUND = "not_found"  # a start whose profile matched nobody
AMBIGUOUS = "ambiguous"  # a start whose profile matched several people

# What a sign-in adds. rate_limited is shared with the rest.
REJECTED = "rejected"  # the email and password, or the code, were not accepted
BLOCKED = "blocked"  # LinkedIn turned the sign-in away
CHALLENGE = "challenge"  # a check Konva cannot complete, such as a CAPTCHA
UNAVAILABLE = "unavailable"  # LinkedIn could not be reached, or answered 5xx
UNSUPPORTED = "unsupported"  # LinkedIn's sign-in page is not one the helper understands
CANCELLED = "cancelled"  # a wait for approval in the app that another command ended

SIGNIN_KINDS = {RATE_LIMITED, BLOCKED, REJECTED, CHALLENGE, UNAVAILABLE, UNSUPPORTED, CANCELLED}


class ResponseError(Exception):
    """LinkedIn answered a request with a status that is not success. A redirect counts: it is LinkedIn
    sending the session to its sign-in page."""

    def __init__(self, status: int) -> None:
        super().__init__(f"status {status}")
        self.status = status


class TokenInvalidated(Exception):
    """LinkedIn ended the session (the real-time stream was told to stop)."""


class SignInError(Exception):
    """A sign-in step failed. checkpoint is where it is waiting when the failure is a wrong code or the like."""

    def __init__(self, kind: str, status: int = 0, stage: str = "", checkpoint: Any = None) -> None:
        super().__init__(kind)
        self.kind, self.status, self.stage, self.checkpoint = kind, status, stage, checkpoint


def error(kind: str, status: int = 0, stage: str = "", sent: int = 0) -> dict:
    """An error body, with only the fields that are set."""
    out: dict = {"kind": kind}
    if status: out["status"] = status
    if stage: out["stage"] = stage
    if sent: out["sent"] = sent
    return out


def fail(id: int, err: dict) -> dict:
    return {"id": id, "ok": False, "error": err}


def done(id: int, result: Any) -> dict:
    return {"id": id, "ok": True, "result": result}


def classify(exc: BaseException) -> dict:
    """The error for an exception from a LinkedIn call."""
    if isinstance(exc, TokenInvalidated): return error(BAD_CREDENTIALS)
    if isinstance(exc, ResponseError):
        s = exc.status
        if s in (401, 302, 303): return error(BAD_CREDENTIALS, s)
        if s == 429: return error(RATE_LIMITED, s)
        if s == 999: return error(REFUSED, s)
        if s == 403: return error(FORBIDDEN, s)
        if 400 <= s < 500: return error(BAD_REQUEST, s)
        return error(FAILED, s)
    return error(FAILED)


def classify_signin(exc: BaseException) -> dict:
    """The error for an exception from a sign-in step."""
    if isinstance(exc, SignInError):
        return error(exc.kind if exc.kind in SIGNIN_KINDS else FAILED, exc.status, exc.stage)
    return error(FAILED)
