"""Whether an email may drive an automation at all: nothing triage flagged, nothing whose headers failed
authentication (security audit 2026-11-04, Medium 2). Pure.

An enquiry's From, body, email and number are all chosen by whoever sent it. The automation then makes a Lead, a
task with their number, an urgent conversation and a reply addressed to their mailbox, so a forged portal email must
stop here, before any of that, whatever the template says."""

from __future__ import annotations

from typing import Any

from ..triage_extras import auth_failed


def untrusted(verdict: dict[str, Any] | None, auth: Any) -> str | None:
    """Why this email may not drive an automation, or None when it may: "suspicious" when triage (the model or the
    header checks, which only ever add a flag) marked it, "auth_failed" when its SPF, DKIM or DMARC results say the
    sender is not who the From claims. verdict is the message's triage result; auth is provider_meta.auth."""
    if (verdict or {}).get("suspicious"):
        return "suspicious"
    if auth_failed(auth):
        return "auth_failed"
    return None
