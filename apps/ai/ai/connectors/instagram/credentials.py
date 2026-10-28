"""What the app saved for an Instagram account, read two ways. Pure.

One provider, two kinds of sign-in, told apart by the "kind" in the sealed credentials: "official" is Instagram
Login for a Business or Creator account (an access token, official.py), "private" is a username and password
for a personal account (instagrapi, sync.py). Credentials saved before the marker existed have none and are
private. A private account may also carry its own "proxy", which wins over INSTAGRAM_PROXY."""

from __future__ import annotations

from typing import Any

OFFICIAL = "official"
PRIVATE = "private"

PROXY_SCHEMES = ("http://", "https://", "socks5://", "socks5h://")


def kind_of(creds: dict[str, Any] | None) -> str:
    return OFFICIAL if creds and creds.get("kind") == OFFICIAL else PRIVATE


def proxy_for(creds: dict[str, Any] | None, default: str | None) -> str | None:
    """The proxy one account signs in through: its own when it has a valid one, else the global one."""
    own = str((creds or {}).get("proxy") or "").strip()
    return own if own.lower().startswith(PROXY_SCHEMES) else default
