"""Files the worker asks to send, and profile pictures. The checks that keep the helper from reading or fetching
anything it was not meant to: attachments must be real files under the temp folder, pictures must be small images
from LinkedIn's own image servers over HTTPS. No LinkedIn calls here; the upload is the client's."""

from __future__ import annotations

import os
import uuid
import urllib.error
import urllib.request
from typing import Callable, Optional
from urllib.parse import urlsplit

from .wire import BAD_REQUEST, ResponseError, error

MAX_ATTACHMENTS = 10
MAX_ATTACHMENT_BYTES = 100 << 20  # a sanity cap; the worker applies LinkedIn's own limit
MAX_PICTURE_BYTES = 2 << 20
KINDS = ("image", "video", "file")


def check_attachments(args: object, root: str) -> tuple[Optional[list[dict]], Optional[dict]]:
    """Validates every file before anything is uploaded, so a bad one sends nothing. A path must be absolute and, once
    symbolic links are followed, a regular non-empty file under root (the temp folder)."""
    bad = error(BAD_REQUEST)
    if not isinstance(args, list) or not 0 < len(args) <= MAX_ATTACHMENTS: return None, bad
    real_root = os.path.realpath(root)
    out = []
    for a in args:
        if not isinstance(a, dict) or a.get("kind") not in KINDS: return None, bad
        name, path = str(a.get("name") or "").strip(), str(a.get("path") or "")
        if not name or not os.path.isabs(path): return None, bad
        real = os.path.realpath(path)
        if not real.startswith(real_root + os.sep) or not os.path.isfile(real): return None, bad
        size = os.path.getsize(real)
        if size <= 0 or size > MAX_ATTACHMENT_BYTES: return None, bad
        out.append({"path": real, "name": name, "mime": str(a.get("mime") or "").strip() or "application/octet-stream", "kind": a["kind"], "size": size})
    return out, None


def file_token(token: str, i: int) -> str:
    """The token of the i-th message of a send: the first is the token itself, the others are derived from it, so a
    retried send still dedupes file by file."""
    return token if i == 0 else str(uuid.uuid5(uuid.NAMESPACE_OID, f"{token}/{i}"))


def picture_host(url: str) -> bool:
    """Whether a picture may be fetched from this address: LinkedIn's image servers, over HTTPS, nothing else."""
    try: u = urlsplit(url.strip()); host, port = (u.hostname or "").lower(), u.port
    except ValueError: return False
    return u.scheme == "https" and port in (None, 443) and "@" not in u.netloc and (host == "licdn.com" or host.endswith(".licdn.com"))


def upload_host(url: str) -> bool:
    """Whether the session's cookies and csrf token may be sent to this upload address: HTTPS on linkedin.com or licdn.com
    (or a subdomain), nothing else. The address comes out of LinkedIn's answer, so it is checked, not trusted."""
    try: u = urlsplit(str(url).strip()); host, port = (u.hostname or "").lower(), u.port
    except ValueError: return False
    return u.scheme == "https" and port in (None, 443) and "@" not in u.netloc and any(host == d or host.endswith("." + d) for d in ("linkedin.com", "licdn.com"))


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None  # a redirect surfaces as its status, which is read as a sign-out


def fetch_picture(url: str, opener: Optional[Callable] = None) -> tuple[bytes, str]:
    """Downloads a picture without the session's cookies and returns it only if it is an image of at most 2 MB.
    Goes through the proxy of the environment. Raises ResponseError for a status, ValueError for anything else wrong."""
    open_ = opener or urllib.request.build_opener(_NoRedirect).open
    req = urllib.request.Request(url, headers={"Accept": "image/*"})
    try:
        with open_(req, timeout=20) as resp:
            media = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            if not media.startswith("image/"): raise ValueError("picture type")
            data = resp.read(MAX_PICTURE_BYTES + 1)
    except urllib.error.HTTPError as e:
        raise ResponseError(e.code) from None
    except (urllib.error.URLError, OSError):
        raise ValueError("picture fetch") from None
    if not data or len(data) > MAX_PICTURE_BYTES: raise ValueError("picture size")
    return data, media
