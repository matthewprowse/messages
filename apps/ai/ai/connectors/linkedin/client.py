"""The interface to LinkedIn that the helper's commands run on, so the commands are tested against a fake and the
real calls are written, and changed when LinkedIn changes, in one place.

Everything an Api returns is already in the helper's own shapes (Person, Message, Conversation: see
apps/linkedin/README.md), as plain dicts with empty fields left out. Failures are ResponseError (a status),
TokenInvalidated or SignInError from wire.py. Nothing here may log what LinkedIn sent.

The real implementation is factory.VoyagerFactory (api, session, realtime, mapping). It signs in with cookies only:
password_login answers `unsupported` until LinkedIn's sign-in request can be made from here. UnavailableFactory
is kept for tests that want every login to fail.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import BinaryIO, Callable, Optional, Protocol

from .wire import SignInError, UNSUPPORTED


@dataclass
class SignedIn:
    """A finished sign-in: the cookies as one Cookie header, and the browser headers (a map of lists) they were created with."""
    cookies: str
    headers: dict = field(default_factory=dict)


class Checkpoint(Protocol):
    """Where a sign-in is waiting. Each step returns SignedIn, or raises SignInError: with a checkpoint when the
    sign-in goes on (a wrong code is `rejected` and keeps its own checkpoint)."""
    kind: str  # email, sms, totp or app
    can_try_another_way: bool

    def submit_code(self, code: str) -> SignedIn: ...
    def try_another_way(self) -> SignedIn: ...
    def wait_for_app(self, cancel: threading.Event) -> SignedIn:
        """Blocks until the app approves, turns it down or times out; raises SignInError(cancelled) once cancel is set."""


class Api(Protocol):
    """One account's session. Each call raises on failure."""
    def conversations_before(self, before_ms: int) -> list[dict]: ...
    def changes(self) -> dict:
        """{'conversations': [...], 'deleted': [urn], 'syncToken': str}"""
    def messages_before(self, conversation: str, before_ms: int, count: int) -> list[dict]: ...
    def send_message(self, conversation: str, text: str, token: str, render: Optional[dict] = None) -> dict: ...
    def upload(self, kind: str, name: str, mime: str, size: int, data: BinaryIO) -> dict:
        """Uploads a file and returns the render content that attaches it to a message."""
    def search(self, name: str) -> list[dict]:
        """People matching a name: {'id', 'firstName', 'lastName'}."""
    def start_conversation(self, me_id: str, recipient_id: str, text: str, token: str, render: Optional[dict] = None) -> dict:
        """One attempt, never repeated here: the message that opened the conversation."""
    def mark_read(self, conversation: str) -> None: ...
    def connect(self, on_event: Callable[[dict], None]) -> None:
        """Starts the real-time stream. on_event takes the event dicts the README lists."""
    def close(self) -> None: ...


class Factory(Protocol):
    def password_login(self, email: str, password: str, proxy: str) -> SignedIn:
        """Raises SignInError, with a checkpoint when it is waiting for a code or an approval."""
    def open(self, cookies: str, headers: dict, page_instance: str, x_li_track: str, sync_token: str) -> tuple[dict, Api]:
        """Checks the session with one request, with those headers: (me, api). Raises ResponseError."""


class UnavailableFactory:
    """Stands in until the real client exists."""
    def password_login(self, email: str, password: str, proxy: str) -> SignedIn: raise SignInError(UNSUPPORTED, stage="client")
    def open(self, cookies: str, headers: dict, page_instance: str, x_li_track: str, sync_token: str) -> tuple[dict, Api]: raise SignInError(UNSUPPORTED, stage="client")
