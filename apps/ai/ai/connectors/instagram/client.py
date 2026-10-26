"""The instagrapi client, set up the same way for every account: a fixed device kept in its settings, South
African locale, an optional proxy, a pause between requests, and nothing of its own in the logs.

The only module that imports instagrapi, and only when an account starts, so the rest of the AI worker and
its tests never need it installed (pip install -r apps/ai/requirements-instagram.txt)."""

from __future__ import annotations

import contextlib
import io
import logging
import sys
from typing import Any, Iterator

# A request every one to three seconds at most, like someone tapping through the app.
DELAY_RANGE = [1, 3]

# Steps instagrapi would answer by itself that change the account: a random birthday, a new password.
# They are left to you in the Instagram app instead.
REFUSED_STEPS = {"add_birthday", "change_password"}


def _silent_logger() -> logging.Logger:
    logger = logging.getLogger("ai.instagram.instagrapi")
    logger.handlers = [logging.NullHandler()]
    logger.propagate = False
    logger.setLevel(logging.CRITICAL)
    return logger


class _OnlyOurLines(io.TextIOBase):
    """Standard output that passes the worker's own JSON log lines and drops anything instagrapi prints
    (it prints a challenge code as it is entered)."""

    def __init__(self, target: Any):
        self.target = target
        self.buffer_text = ""

    def write(self, text: str) -> int:
        self.buffer_text += text
        while "\n" in self.buffer_text:
            line, self.buffer_text = self.buffer_text.split("\n", 1)
            if line.startswith("{"):
                self.target.write(line + "\n")
                self.target.flush()
        return len(text)


@contextlib.contextmanager
def quiet() -> Iterator[None]:
    with contextlib.redirect_stdout(_OnlyOurLines(sys.__stdout__)):
        yield


def make_client(settings: dict[str, Any] | None, proxy: str | None) -> Any:
    """A client with this account's saved settings (its device, IDs and session), or a new device for an
    account signing in for the first time. Makes no request."""
    from instagrapi import Client
    from instagrapi.exceptions import ChallengeRequired

    class KonvaClient(Client):
        def challenge_resolve_simple(self, challenge_url: str) -> bool:
            if (self.last_json or {}).get("step_name") in REFUSED_STEPS:
                raise ChallengeRequired(**{k: v for k, v in (self.last_json or {}).items() if k != "message"})
            return super().challenge_resolve_simple(challenge_url)

    client = KonvaClient(delay_range=DELAY_RANGE, logger=_silent_logger())
    if settings:
        client.set_settings(settings)
    else:
        client.set_locale("en_ZA")
        client.set_country("ZA")
        client.set_country_code(27)
        client.set_timezone_offset(2 * 3600)
    if proxy:
        client.set_proxy(proxy)
    client.with_challenge_flow = False  # only a sign-in answers challenges; anywhere else one stops the account
    return client
