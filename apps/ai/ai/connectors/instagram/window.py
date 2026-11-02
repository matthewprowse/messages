"""When Meta lets a Business or Creator account answer a message, as one pure rule the connector and its tests share.

Standard messaging: within 24 hours of the person's last message. Outside that, Meta allows a reply sent by a
human (not an automation) with the HUMAN_AGENT message tag for 7 days after their last message, but only to an
app that was granted the "Human Agent" feature in App Review; without it, a late reply is refused by Meta
itself. Every reply here is one you wrote and sent yourself in Konva, which is what the tag is for. Past 7 days
(or with no message from them at all) nothing is allowed and the reply has to go in Instagram."""

from __future__ import annotations

from datetime import datetime, timedelta

STANDARD = timedelta(hours=24)
HUMAN_AGENT = timedelta(days=7)

OPEN = "standard"  # a plain reply
TAGGED = "human_agent"  # a reply with the HUMAN_AGENT tag
CLOSED = "closed"  # nothing may be sent


def reply_mode(last_inbound_at: datetime | None, now: datetime, human_agent: bool) -> str:
    """OPEN, TAGGED or CLOSED for a reply now, given when they last wrote and whether the app has Human Agent."""
    if last_inbound_at is None:
        return CLOSED
    age = now - last_inbound_at
    if age < STANDARD:
        return OPEN
    if human_agent and age < HUMAN_AGENT:
        return TAGGED
    return CLOSED
