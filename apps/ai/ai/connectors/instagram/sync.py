"""One Instagram account, in a thread of its own: sign in once (or pick up the saved session), then read
the inbox every few minutes and send what you queued in the app.

The inbox is read with the same requests instagrapi's direct_threads_chunk and direct_thread make
(instagrapi 3.2.1), through private_request, so the JSON arrives untouched for mapping. Reading the inbox
or a thread never marks anything seen; only a 'read' action from the app does, for that one thread. Every
Instagram call happens on this thread, one at a time, with instagrapi's pause between requests."""

from __future__ import annotations

import json
import random
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from ... import log
from .backoff import Backoff, kind_of, poll_wait, trouble
from .client import quiet
from .mapping import Thread, inbox, is_unread, payload, sent_item, thread as map_thread
from .signin import SignInFailed, SignInStopped, sign_in
from .store import SignInRow, Store, fetch

LOOP_S = 5.0  # the outbox and actions are checked this often; they are database reads until there is work
FIRST_PAGES = 2  # the first sync reads the 40 most recent threads
THREAD_PAGES = 2  # at most 40 messages of one thread per poll, when more arrived than the inbox shows
SESSION_SAVE_S = 600.0
PAUSE_S = (2.0, 5.0)  # between reading one thread and the next, like scrolling

INBOX_PARAMS = {
    "visual_message_return_type": "unseen",
    "thread_message_limit": "10",
    "persistentBadging": "true",
    "limit": "20",
    "is_prefetching": "false",
    "fetch_reason": "initial_snapshot",
    "include_old_mrs": "false",
    "no_pending_badge": "true",
    "push_disabled": "true",
}
THREAD_PARAMS = {"visual_message_return_type": "unseen", "direction": "older", "seq_id": "40065", "limit": "20"}

TEXT_ONLY = "Instagram replies can only be text for now. Remove the attachments and send again."
MAY_HAVE_SENT = "The message may not have been sent. Check Instagram before sending again."


@dataclass(frozen=True)
class Settings:
    proxy: str | None
    initial_sync_days: int


class AccountSync:
    def __init__(
        self,
        store: Store,
        account: dict[str, Any],
        settings: Settings,
        stop: threading.Event,
        *,
        on_credentials: Callable[[str | None], None] = lambda _updated: None,
        make_client: Callable[[dict[str, Any] | None, str | None], Any] | None = None,
        rand: Callable[[], float] = random.random,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.store = store
        self.account = account
        self.id = account["id"]
        self.user_id = account["user_id"]
        self.settings = settings
        self.stop = stop
        self.on_credentials = on_credentials
        self.make_client = make_client
        self.rand = rand
        self.clock = clock
        self.backoff = Backoff(rand)
        self.viewer = ""
        self.username = ""
        self.saved_settings = ""
        self.saved_at = 0.0
        self.paused_until = 0.0
        self.connected = False

    # -- starting ---------------------------------------------------------------------------------------

    def run(self) -> None:
        try:
            client = self.connect()
            if client is not None:
                self.loop(client)
        except SignInStopped:
            log.info("instagram sign-in stopped", account=self.id)
        except Exception as err:
            log.error("instagram account failed", account=self.id, code=log.code_of(err))
            self.store.set_status(self.account, "error", "Instagram sync stopped after an error. Connect again in Settings.")

    def _client(self, settings: dict[str, Any] | None) -> Any:
        if self.make_client:
            return self.make_client(settings, self.settings.proxy)
        from .client import make_client

        return make_client(settings, self.settings.proxy)

    def connect(self) -> Any:
        """A signed-in client: signed in now when the app has just saved a password, else the saved session
        as it is, with no request at all. None when the account stopped instead."""
        creds, session = self.store.credentials(self.id)
        if not creds or not creds.get("username"):
            self.store.set_status(self.account, "error", "Connect Instagram again in Settings.")
            return None
        username = str(creds["username"])
        same = session and str(session.get("username", "")).lower() == username.lower()
        # The saved device is kept for every later sign-in, so Instagram keeps seeing the same phone.
        client = self._client(session.get("settings") if same and session else None)
        if creds.get("password"):
            self.store.set_status(self.account, "connecting", "Signing in to Instagram.")
            try:
                with quiet():
                    sign_in(client, username, str(creds["password"]), SignInRow(self.store, self.account), self.stop)
            except SignInFailed as failed:
                log.warn("instagram sign-in failed", account=self.id, code=failed.code)
                self.store.emit(self.user_id, "account_connect", provider="instagram", step="sign_in", outcome="failed", code=failed.code)
                self.store.set_status(self.account, "error", failed.detail)
                return None
            self.save_session(client, username, force=True)
            self.on_credentials(self.store.forget_password(self.id, username))
            self.store.signed_in(self.account, username)
            log.info("instagram signed in", account=self.id)
        elif not same:
            self.store.set_status(self.account, "error", "Connect Instagram again in Settings.")
            return None
        self.username = username
        self.viewer = str(client.user_id or "")
        if not self.viewer:
            self.store.set_status(self.account, "error", "Instagram signed Konva out. Connect again in Settings.")
            return None
        return client

    def save_session(self, client: Any, username: str, force: bool = False) -> None:
        """Keeps instagrapi's settings when they changed (cookies and headers Instagram rotates), at most
        every few minutes."""
        settings = client.get_settings()
        dumped = json.dumps(settings, sort_keys=True, default=str)
        if dumped == self.saved_settings or (not force and self.clock() - self.saved_at < SESSION_SAVE_S):
            return
        self.store.save_session(self.id, username, settings)
        self.saved_settings = dumped
        self.saved_at = self.clock()

    # -- the loop ---------------------------------------------------------------------------------------

    def loop(self, client: Any) -> None:
        quiet_since = self.clock()
        next_poll = self.clock()
        newest = self.store.newest_seen(self.id)
        if newest is None:
            self.store.set_status(self.account, "syncing", "Importing your recent Instagram chats.")
        while not self.stop.is_set():
            try:
                if self.clock() >= self.paused_until:
                    self.send_outbox(client)
                    self.apply_actions(client)
                if self.clock() >= next_poll:
                    stored = self.poll(client)
                    if stored:
                        quiet_since = self.clock()
                    if not self.connected:
                        self.store.set_status(self.account, "connected")
                        self.connected = True
                    elif self.backoff.failures:
                        self.store.set_status(self.account, "connected")  # clears the reason it was waiting
                    else:
                        self.store.touch(self.id)
                    self.backoff.reset()
                    self.save_session(client, self.username)
                    next_poll = self.clock() + poll_wait(self.clock() - quiet_since, self.rand)
            except Exception as err:
                t = trouble(err)
                log.warn("instagram request failed", account=self.id, kind=t.kind, code=log.code_of(err))
                self.store.emit(self.user_id, "sync_error", provider="instagram", code=t.kind)
                if t.stop:
                    self.store.set_status(self.account, "error", t.detail)
                    return
                wait = self.backoff.next(t)
                next_poll = self.paused_until = self.clock() + wait
                self.store.set_detail(self.id, t.detail)
                log.info("instagram backing off", account=self.id, kind=t.kind, inS=round(wait))
            self.stop.wait(LOOP_S)

    # -- reading ----------------------------------------------------------------------------------------

    def poll(self, client: Any) -> int:
        """Reads the inbox and stores what is new. Returns how many new messages from others were stored."""
        newest = self.store.newest_seen(self.id)
        first = newest is None
        threads: list[Thread] = []
        cursor = None
        for _ in range(FIRST_PAGES if first else 1):
            params = {**INBOX_PARAMS, "eb_device_id": "0", "igd_request_log_tracking_id": client.generate_uuid()}
            if cursor:
                params.update({"cursor": cursor, "direction": "older", "fetch_reason": "page_scroll"})
            found, cursor = inbox(client.private_request("direct_v2/inbox/", params=params), self.viewer)
            threads.extend(found)
            if not cursor:
                break
            self.pause()

        sealer = self.store.sealer(self.user_id)
        stored = 0
        latest = newest or 0
        read_here: list[str] = []
        for t in threads:
            if not t.items:
                continue
            latest = max(latest, t.items[0].timestamp_us)
            if not any(is_unread(t, i, self.viewer) for i in t.items):
                read_here.append(t.id)
            if newest is not None and t.items[0].timestamp_us <= newest:
                continue  # nothing new in this thread since the last poll
            if newest is not None and t.items[-1].timestamp_us > newest and (t.has_older or t.oldest_cursor):
                self.pause()
                self.older(client, t, newest)
            stored += self.store_thread(client, sealer, t, newest)
        if threads:
            self.store.mark_read_on_phone(self.id, sealer, read_here)
        if latest and latest != newest:
            self.store.save_newest(self.id, latest)
        if stored:
            log.info("instagram messages stored", account=self.id, threads=len(threads), inserted=stored)
        return stored

    def older(self, client: Any, t: Thread, newest: int) -> None:
        """More of a thread than the inbox showed, back to the last poll, a page at a time."""
        cursor = t.oldest_cursor
        for _ in range(THREAD_PAGES):
            if not cursor:
                return
            response = client.private_request(f"direct_v2/threads/{t.id}/", params={**THREAD_PARAMS, "cursor": cursor})
            page = map_thread(response.get("thread") or {}, self.viewer)
            if not page:
                return
            known = {i.id for i in t.items}
            t.items.extend(i for i in page.items if i.id not in known)
            t.items.sort(key=lambda i: i.timestamp_us, reverse=True)
            if not page.items or page.items[-1].timestamp_us <= newest:
                return
            cursor = page.oldest_cursor
            self.pause()

    def store_thread(self, client: Any, sealer: Any, t: Thread, newest: int | None) -> int:
        items = [i for i in reversed(t.items) if newest is None or i.timestamp_us > newest]
        payloads = [payload(sealer, t, i, self.viewer, live=newest is not None, unread=is_unread(t, i, self.viewer)) for i in items]
        results = self.store.ingest(self.id, payloads)
        stored = 0
        since = datetime.now(timezone.utc) - timedelta(days=self.settings.initial_sync_days)
        for item, result in zip(items, results):
            if not isinstance(result, dict) or result.get("result") != "inserted":
                if isinstance(result, dict) and result.get("result") == "error":
                    log.warn("instagram message failed", account=self.id, code=result.get("code"))
                continue
            if item.sender_pk != self.viewer:
                stored += 1
            attachment = (result.get("attachment_ids") or [None])[0]
            if item.media and attachment and (newest is not None or item.sent_at >= since):
                self.save_file(client, item.media, result["message_id"], attachment)
        return stored

    def save_file(self, client: Any, media: Any, message_id: str, attachment_id: str) -> None:
        try:
            data = fetch(media.url, self.settings.proxy, getattr(client, "user_agent", None))
            if data is not None:
                self.store.save_file(self.user_id, message_id, attachment_id, data, media.mime_type)
        except Exception as err:  # the message is stored either way; a lost file is not worth stopping for
            log.warn("instagram file failed", account=self.id, attachment=attachment_id, code=log.code_of(err))

    def pause(self) -> None:
        self.stop.wait(PAUSE_S[0] + (PAUSE_S[1] - PAUSE_S[0]) * self.rand())

    # -- sending ----------------------------------------------------------------------------------------

    def send_outbox(self, client: Any) -> None:
        """Sends replies you queued in the app, one at a time, each claimed first so it never goes twice."""
        for row in self.store.queued_outbox(self.id):
            if self.stop.is_set():
                return
            self.send(client, row)

    def send(self, client: Any, row: dict[str, Any]) -> None:
        thread_row = row.get("threads") or {}
        if thread_row.get("account_id") != self.id or thread_row.get("user_id") != row.get("user_id") or thread_row.get("channel") != "instagram":
            return
        if not self.store.claim(row["id"]):
            return
        if (row.get("attachment_count") or 0) > 0:
            self.store.fail(row["id"], TEXT_ONLY)
            return
        text = self.store.body(row["user_id"], row.get("body")).strip()
        thread_id = self.store.address(row["user_id"], thread_row.get("provider_thread_id"))
        if not text:
            self.store.fail(row["id"], "There is nothing to send.")
            return
        if not thread_id.isdigit():
            self.store.fail(row["id"], "This conversation could not be found on Instagram.")
            return
        client.last_json = {}  # so an ID from an earlier request can never be read as this one's
        try:
            sent = client.direct_send(text, thread_ids=[int(thread_id)])
            item_id = str(getattr(sent, "id", "") or "")
        except Exception as err:
            # instagrapi reads the reply into its own model after Instagram has taken it; if only that step
            # failed, the message went out and its ID is in the raw response.
            item_id = "" if kind_of(err) != "other" else str(((getattr(client, "last_json", None) or {}).get("payload") or {}).get("item_id") or "")
            if not item_id:
                self.store.fail(row["id"], MAY_HAVE_SENT)
                log.warn("instagram reply failed", account=self.id, outbox=row["id"], code=log.code_of(err))
                raise
        if self.store.settle(row["id"], item_id):
            log.info("instagram reply sent", account=self.id, outbox=row["id"])
        item = sent_item(item_id, self.viewer, text)
        t = Thread(id=thread_id, title=thread_row.get("group_name"), is_group=bool(thread_row.get("is_group")), people=[])
        try:
            self.store.ingest(self.id, [payload(self.store.sealer(self.user_id), t, item, self.viewer, live=True, unread=False)])
        except Exception as err:
            log.warn("store sent instagram failed", account=self.id, outbox=row["id"], code=log.code_of(err))

    # -- actions ----------------------------------------------------------------------------------------

    def apply_actions(self, client: Any) -> None:
        """'read' means you opened the thread in the app: only then is Instagram told you saw it. Archiving
        and the rest stay in the app. Reactions are not sent to Instagram yet."""
        for row in self.store.queued_actions(self.id):
            action = row.get("action")
            if action == "react":
                self.store.finish_action(row["id"], "Reactions are not sent to Instagram yet.")
                continue
            if action != "read":
                self.store.finish_action(row["id"])
                continue
            pending = self.store.pending_receipts(self.id, row["thread_id"])
            if not pending:
                self.store.finish_action(row["id"])
                continue
            thread_id = self.store.address(row["user_id"], (row.get("threads") or {}).get("provider_thread_id"))
            try:
                client.direct_message_seen(thread_id, pending[0]["provider_message_id"])
            except Exception:
                self.store.finish_action(row["id"], "Could not tell Instagram you read this chat.")
                raise
            self.store.set_receipts(self.id, [m["id"] for m in pending], "sent")
            self.store.finish_action(row["id"])
            log.info("instagram thread seen", account=self.id, messages=len(pending))
