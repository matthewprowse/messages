"""Reading mail for automations: a message's body as text and links, and the user's own addresses. Both the live engine and the
30 day preview use these. Reads only. Bodies are opened here and kept in memory for the run; nothing is logged."""

from __future__ import annotations

from typing import Any

from ..fields import ADDRESS, BODY, HTML
from ..supabase import in_list
from .read import prepare

CHUNK = 25  # bodies read in one request: they are the heavy part of a message row


def own_addresses(db: Any, vault: Any, user: str) -> set[str]:
    """The user's own account and send-as addresses, lowercase, so a lead is never taken to be the user themselves."""
    rows = db.select("accounts", {"select": "address,send_addresses", "user_id": f"eq.{user}"})
    mine: set[str] = set()
    for a in rows:
        for value in [a.get("address"), *(a.get("send_addresses") or [])]:
            opened = (vault.open(user, ADDRESS, value) or "").strip().lower() if value else ""
            if "@" in opened:
                mine.add(opened)
    return mine


def bodies(db: Any, vault: Any, user: str, ids: list[str]) -> dict[str, tuple[str, list[str]]]:
    """For each message id, its body as text and the links in it. A message whose body cannot be read is left out."""
    out: dict[str, tuple[str, list[str]]] = {}
    for i in range(0, len(ids), CHUNK):
        for r in db.select("messages", {"select": "id,body_text,body_html", "user_id": f"eq.{user}", "id": in_list(ids[i : i + CHUNK])}):
            out[r["id"]] = prepare(vault.open(user, BODY, r.get("body_text")), vault.open(user, HTML, r.get("body_html")))
    return out
