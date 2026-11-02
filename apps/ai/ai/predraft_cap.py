"""The per-user daily cap on pre-drafts (docs/PLAN.md, Pre-Drafting). public.request_auto_draft already refuses past
PER_USER_PER_DAY, but a signed-in client can insert a drafts row with auto=true directly, which skips that function.
The worker checks the same count before paying for one, so the cap holds however the row got there. The count is the
SQL's: pre-drafts the model wrote in the last 24 hours (model is set only once the model has run, so a dropped one
is free). Keep the number in step with the migration."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from . import log

PER_USER_PER_DAY = 15  # 20261109100100_pre_draft_needs_reply_gate.sql lowered it from 30


def user_cap_reached(db: Any, user_id: str, cap: int = PER_USER_PER_DAY) -> bool:
    """True when the person has had their cap of pre-drafts written in the past day. A count that cannot be read
    never holds drafts up."""
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    try:
        made = db.count("drafts", {"user_id": f"eq.{user_id}", "auto": "is.true", "model": "not.is.null", "created_at": f"gte.{since}"})
    except Exception as err:
        log.warn("pre-draft cap not checked", code=log.code_of(err))
        return False
    return made >= cap
