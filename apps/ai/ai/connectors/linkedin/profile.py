"""Who a first message is to: reads a profile URN, a linkedin.com/in/ URL, a public identifier or a name, and picks
the one search result that is that person. Pure. A first message is never sent to a guess."""

from __future__ import annotations

import unicodedata
from typing import Optional
from urllib.parse import unquote, urlsplit

from .wire import AMBIGUOUS, NOT_FOUND, error

PROFILE_PREFIX = "urn:li:fsd_profile:"


def parse_profile(text: str) -> Optional[dict]:
    """{'id': ...} for a profile URN, {'name': ...} for anything that names a person by words, None for anything else."""
    s = text.strip()
    if not s: return None
    if s.startswith(PROFILE_PREFIX):
        pid = s[len(PROFILE_PREFIX):]
        if not pid or any(c in pid for c in " /?#:,()"): return None
        return {"id": pid}
    slug = s
    if "linkedin.com" in s.lower():
        parts = urlsplit(s if "://" in s else "https://" + s)
        host = (parts.hostname or "").lower()
        if not (host == "linkedin.com" or host.endswith(".linkedin.com")): return None
        segs = parts.path.strip("/").split("/")
        if len(segs) < 2 or segs[0] != "in" or not segs[1]: return None
        slug = unquote(segs[1])
    elif any(c in s for c in "/:?#"):
        return None
    name = name_from_slug(slug)
    return {"name": name} if name else None


def name_from_slug(slug: str) -> str:
    """The words of an identifier without the numbers and hex LinkedIn appends ("jane-doe-1a2b3c4d" is "jane doe")."""
    words = [w for w in "".join(" " if c in "-_." or c.isspace() else c for c in slug).split() if w]
    while len(words) > 1 and any(c.isdigit() for c in words[-1]): words.pop()
    return " ".join(words)


def fold_name(s: str) -> str:
    """Lowercase, no accents, and only letters and digits, so "José Peña" and "jose-pena" compare equal."""
    s = s.lower().replace("ß", "ss").replace("ø", "o")
    s = unicodedata.normalize("NFD", s)
    return "".join(c for c in s if c.isalnum() and not unicodedata.combining(c))


def pick_profile(results: list[dict], name: str) -> tuple[Optional[dict], Optional[dict]]:
    """(person, None) for the one result whose full name is the name asked for, else (None, error): not_found for
    none and ambiguous for several. A result is {'id', 'firstName', 'lastName'}."""
    want, found, seen = fold_name(name), [], set()
    for r in results:
        pid = r.get("id") or ""
        if not pid or pid in seen or fold_name(f"{r.get('firstName', '')} {r.get('lastName', '')}") != want: continue
        seen.add(pid)
        found.append({"id": pid, "urn": PROFILE_PREFIX + pid, "kind": "member", "firstName": (r.get("firstName") or "").strip(), "lastName": (r.get("lastName") or "").strip()})
    if not found: return None, error(NOT_FOUND)
    if len(found) > 1: return None, error(AMBIGUOUS)
    return found[0], None
