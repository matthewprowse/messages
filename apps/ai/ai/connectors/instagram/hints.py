"""Webhook hints, read by the connector: a row the web app's Meta webhook (apps/web/app/api/meta/webhook) writes
when Meta says an Instagram account has news. A hint carries no conversation, sender or text (see
20261120130000_meta_webhook_hints.sql); it only means "read this account's inbox now". Pure rules live here so
they are tested without a database or a clock; the store does the reading."""

from __future__ import annotations

from ...config import flag_on

QUIET_AFTER_S = 2 * 3600.0  # with no news for this long, the safety poll slows to its longest wait
SAFETY_S = 15 * 60.0
SAFETY_QUIET_S = 30 * 60.0
JITTER = 0.25


def webhooks_on() -> bool:
    """Whether Meta's webhook is set up for this deployment (INSTAGRAM_WEBHOOKS in apps/ai/.env). Off by default:
    until the owner has saved the callback URL in the Meta app, the connector polls as it always did."""
    return flag_on("INSTAGRAM_WEBHOOKS", default=False)


def human_agent_on() -> bool:
    """Whether Meta granted the app the Human Agent feature (INSTAGRAM_HUMAN_AGENT). Off by default, because
    without it Meta refuses a reply after 24 hours and a failed send is worse than saying so up front."""
    return flag_on("INSTAGRAM_HUMAN_AGENT", default=False)


def safety_wait(quiet_s: float, rand) -> float:
    """Seconds until the next full inbox read when hints do the real work: a safety net for a lost delivery."""
    base = SAFETY_S if quiet_s < QUIET_AFTER_S else SAFETY_QUIET_S
    return base * (1 + JITTER * (2 * rand() - 1))


def has_news(hints: list[dict]) -> bool:
    """Whether any hint is worth a read. A read receipt on a conversation changes nothing stored, so it is not."""
    return any(h.get("kind") in ("message", "reaction", "other") for h in hints)
