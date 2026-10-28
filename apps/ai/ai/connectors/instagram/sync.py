"""One Instagram account, in a thread of its own: sign in once (or pick up the saved session), then read
the inbox every few minutes and send what you queued in the app.

The inbox is read with the same requests instagrapi's direct_threads_chunk and direct_thread make
(instagrapi 3.2.1), through private_request, so the JSON arrives untouched for mapping. Reading the inbox
or a thread never marks anything seen; only a 'read' action from the app does, for that one thread. Every
Instagram call happens on this thread, one at a time, with instagrapi's pause between requests."""

from __future__ import annotations

import json
import os
import random
import re
import tempfile
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from ... import log
from .backoff import Backoff, kind_of, poll_wait, trouble
from .client import quiet
from .credentials import proxy_for
from . import outgoing
from .mapping import Person, Thread, inbox, is_unread, payload, sent_item, thread as map_thread
from .signin import SignInFailed, SignInStopped, sign_in
from .store import AVATAR_MAX_BYTES, DEFAULT_AVATAR, SignInRow, Store, fetch

LOOP_S = 5.0  # the outbox and actions are checked this often; they are database reads until there is work
FIRST_PAGES = 2  # the first sync reads the 40 most recent threads
THREAD_PAGES = 2  # at most 40 messages of one thread per poll, when more arrived than the inbox shows
SESSION_SAVE_S = 600.0
PAUSE_S = (2.0, 5.0)  # between reading one thread and the next, like scrolling
FILE_PAUSE_S = (1.0, 2.5)  # between the items of one message with files
PHOTOS_PER_THREAD = 5  # profile photos fetched per thread per poll
PHOTO_RECHECK_S = 86400.0  # a person's photo is looked at no more than daily per run, whatever came of it

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
# Primary is the default inbox. General is the folder Instagram files business chats into, and requests are
# people you do not follow. Each has its own "newest seen" mark, so a quiet one is never skipped by a busy one.
GENERAL_SCOPE = "instagram_inbox_general"
REQUESTS_SCOPE = "instagram_inbox_requests"
BOXES: tuple[tuple[str, dict[str, str] | None, str | None], ...] = (
    ("direct_v2/inbox/", None, None),
    ("direct_v2/inbox/", {"folder": "1"}, GENERAL_SCOPE),
    ("direct_v2/pending_inbox/", {}, REQUESTS_SCOPE),
)
THREAD_PARAMS = {"visual_message_return_type": "unseen", "direction": "older", "seq_id": "40065", "limit": "20"}

TEXT_ONLY = "Instagram replies can only be text for now. Remove the attachments and send again."
MAY_HAVE_SENT = "The message may not have been sent. Check Instagram before sending again."
PARTIAL = "Only part of this message was sent ({done} of {total} items). Check Instagram before sending again."
USERNAME = re.compile(r"^[a-z0-9._]{1,30}$")  # what Instagram allows in a username, once lowercased
BAD_USERNAME = "Enter an Instagram username, like ana.m."
NO_SUCH_USER = "No Instagram account has that username."
LOOKUP_FAILED = "Could not look up that Instagram username. Nothing was sent. Try again in a little while."
OWN_USERNAME = "That is your own Instagram account."
FIRST_MESSAGES_PER_DAY = 5  # new conversations started per account per rolling 24 hours; INSTAGRAM_FIRST_MESSAGES_PER_DAY overrides
DAILY_LIMIT = "Instagram limits first messages to {cap} a day to protect your account. Try again tomorrow."


def first_message_cap() -> int:
    try:
        return max(0, int(os.environ.get("INSTAGRAM_FIRST_MESSAGES_PER_DAY") or FIRST_MESSAGES_PER_DAY))
    except ValueError:
        return FIRST_MESSAGES_PER_DAY


def username_of(value: str) -> str:
    """The username in what was typed: no spaces, no @, no profile link, lowercase. May still be invalid."""
    text = value.strip().lower()
    text = re.sub(r"^(https?://)?(www\.)?instagram\.com/", "", text)
    return text.split("/", 1)[0].split("?", 1)[0].lstrip("@")


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
        self.proxy = settings.proxy  # this account's own when its credentials have one (connect), else the global one
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
        self.seen_marked: dict[str, int] = {}  # thread id -> how far the others had seen it when last recorded, this run
        self.photo_checked: dict[str, float] = {}  # person pk -> when their photo was last looked at, this run

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
            return self.make_client(settings, self.proxy)
        from .client import make_client

        return make_client(settings, self.proxy)

    def connect(self) -> Any:
        """A signed-in client: signed in now when the app has just saved a password, else the saved session
        as it is, with no request at all. None when the account stopped instead."""
        creds, session = self.store.credentials(self.id)
        if not creds or not creds.get("username"):
            self.store.set_status(self.account, "error", "Connect Instagram again in Settings.")
            return None
        username = str(creds["username"])
        self.proxy = proxy_for(creds, self.settings.proxy)
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
            self.on_credentials(self.store.forget_password(self.id, username, proxy_for(creds, None)))
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
        """Reads the primary inbox, then general and message requests, and stores what is new. Returns how many
        new messages from others were stored. Only the primary read may stop the sync: a failure in the other
        two is logged and tried again next time."""
        stored = 0
        for endpoint, extra, scope in BOXES:
            if scope is None:
                stored += self.poll_box(client, endpoint, extra, scope)
                continue
            self.pause()
            try:
                stored += self.poll_box(client, endpoint, extra, scope)
            except Exception as err:
                log.warn("instagram folder failed", account=self.id, folder=scope, code=log.code_of(err))
        return stored

    def poll_box(self, client: Any, endpoint: str, extra: dict[str, str] | None, scope: str | None) -> int:
        """One folder of the inbox, with its own newest-seen mark."""
        newest = self.store.newest_seen(self.id, scope) if scope else self.store.newest_seen(self.id)
        first = newest is None
        threads: list[Thread] = []
        cursor = None
        for _ in range(FIRST_PAGES if first else 1):
            params = {**INBOX_PARAMS, "eb_device_id": "0", "igd_request_log_tracking_id": client.generate_uuid(), **(extra or {})}
            if cursor:
                params.update({"cursor": cursor, "direction": "older", "fetch_reason": "page_scroll"})
            found, cursor = inbox(client.private_request(endpoint, params=params), self.viewer)
            threads.extend(found)
            if not cursor:
                break
            self.pause()

        sealer = self.store.sealer(self.user_id)
        stored = 0
        latest = newest or 0
        read_here: list[str] = []
        for t in threads:
            self.record_seen(sealer, t)
            if not t.items:
                continue
            latest = max(latest, t.items[0].timestamp_us)
            if not any(is_unread(t, i, self.viewer) for i in t.items):
                read_here.append(t.id)
            if newest is not None and t.items[0].timestamp_us <= newest:
                self.save_photos(client, sealer, t)  # quiet, but a photo it lacks is still fetched, once a day at most
                continue  # nothing new in this thread since the last poll
            if newest is not None and t.items[-1].timestamp_us > newest and (t.has_older or t.oldest_cursor):
                self.pause()
                self.older(client, t, newest)
            stored += self.store_thread(client, sealer, t, newest)
        if threads:
            self.store.mark_read_on_phone(self.id, sealer, read_here)
        if latest and latest != newest:
            self.store.save_newest(self.id, latest, scope) if scope else self.store.save_newest(self.id, latest)
        if stored:
            log.info("instagram messages stored", account=self.id, folder=scope or "primary", threads=len(threads), inserted=stored)
        return stored

    def record_seen(self, sealer: Any, t: Thread) -> None:
        """Shows your messages as seen once the others have seen the thread (in a group, all of them have).
        Only a time newer than the last one recorded is sent, and a failure is logged and tried again next poll."""
        if not t.others_seen_us or t.others_seen_us <= self.seen_marked.get(t.id, 0):
            return
        try:
            self.store.mark_seen(self.id, sealer, t.id, t.others_seen_us)
            self.seen_marked[t.id] = t.others_seen_us
        except Exception as err:
            log.warn("instagram seen failed", account=self.id, code=log.code_of(err))

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
            if item.media and attachment:
                self.store.set_hints(attachment, item.media.filename)
            if item.media and attachment and (newest is not None or item.sent_at >= since):
                self.save_file(client, item.media, result["message_id"], attachment)
        self.save_photos(client, sealer, t)
        return stored

    def save_photos(self, client: Any, sealer: Any, t: Thread) -> None:
        """Profile photos for the people of a thread that has news, as their contacts' avatars. Fetched only
        when a contact has none or an Instagram one over a week old, and never allowed to hold up or fail the sync."""
        fetched = 0
        for p in t.people:
            if fetched >= PHOTOS_PER_THREAD:
                return
            if not p.picture or DEFAULT_AVATAR in p.picture:
                continue
            last = self.photo_checked.get(p.pk)
            if last is not None and self.clock() - last < PHOTO_RECHECK_S:
                continue
            self.photo_checked[p.pk] = self.clock()
            try:
                contact = self.store.contact_to_photograph(self.user_id, sealer, p.pk)
                if not contact:
                    continue
                fetched += 1
                data = fetch(p.picture, self.proxy, getattr(client, "user_agent", None), limit=AVATAR_MAX_BYTES, timeout=20)
                if data:
                    self.store.save_contact_photo(self.user_id, contact, data)
            except Exception as err:  # the URL is signed and personal: only the code is logged
                log.warn("instagram photo failed", account=self.id, code=log.code_of(err))

    def save_file(self, client: Any, media: Any, message_id: str, attachment_id: str) -> None:
        try:
            data = fetch(media.url, self.proxy, getattr(client, "user_agent", None))
            if data is not None:
                self.store.save_file(self.user_id, message_id, attachment_id, data, media.mime_type, media.kind, self.id)
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
        for n, row in enumerate(self.store.queued_new_chats(self.id)):
            if self.stop.is_set():
                return
            if n:
                self.pause()  # first messages to strangers are the ones Instagram watches most
            self.send_new(client, row)

    def send(self, client: Any, row: dict[str, Any]) -> None:
        thread_row = row.get("threads") or {}
        if thread_row.get("account_id") != self.id or thread_row.get("user_id") != row.get("user_id") or thread_row.get("channel") != "instagram":
            return
        files = int(row.get("attachment_count") or 0)
        # The app adds the file rows only while the row is queued, so they are waited for before it is claimed.
        waited = outgoing.wait_for_files(self.store, row, self.stop) if files else None
        if not self.store.claim(row["id"]):
            return
        if waited:
            self.store.fail(row["id"], waited)
            return
        text = self.store.body(row["user_id"], row.get("body")).strip()
        thread_id = self.store.address(row["user_id"], thread_row.get("provider_thread_id"))
        if files:
            if not thread_id.isdigit():
                self.store.fail(row["id"], "This conversation could not be found on Instagram.")
                return
            self.send_files(client, row, thread_row, thread_id, text)
            return
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

    def send_files(self, client: Any, row: dict[str, Any], thread_row: dict[str, Any], thread_id: str, text: str) -> None:
        """A reply with photos or videos: everything is checked and written to a private temporary folder
        first, so a bad file fails the row before anything goes out. Then the text, then each file in order,
        one at a time. What already went is never sent again: a failure part way says how far it got, and an
        item whose outcome is unknown is treated as maybe sent, like a single reply."""
        with tempfile.TemporaryDirectory(prefix="konva-ig-") as folder:  # created 0700
            try:
                files = outgoing.load_files(self.store, row, folder)
            except outgoing.Rejected as rejected:
                self.store.fail(row["id"], rejected.reason)
                return
            except Exception as err:  # storage down: nothing was sent, so say so
                self.store.fail(row["id"], outgoing.UNREADABLE)
                log.warn("instagram attachments failed", account=self.id, outbox=row["id"], code=log.code_of(err))
                return
            steps: list[outgoing.OutFile | None] = ([None] if text else []) + list(files)  # None is the text
            first_id = ""
            for n, step in enumerate(steps):
                if n:
                    self.stop.wait(FILE_PAUSE_S[0] + (FILE_PAUSE_S[1] - FILE_PAUSE_S[0]) * self.rand())
                client.last_json = {}  # so an ID from an earlier request can never be read as this one's
                try:
                    if step is None:
                        sent = client.direct_send(text, thread_ids=[int(thread_id)])
                    elif step.kind == "photo":
                        sent = client.direct_send_photo(step.path, thread_ids=[int(thread_id)])
                    else:
                        sent = client.direct_send_video(step.path, thread_ids=[int(thread_id)])
                    item_id = str(getattr(sent, "id", "") or "")
                except Exception as err:
                    item_id = "" if kind_of(err) != "other" else str(((getattr(client, "last_json", None) or {}).get("payload") or {}).get("item_id") or "")
                    if not item_id:
                        self.store.fail(row["id"], PARTIAL.format(done=n, total=len(steps)) if n else MAY_HAVE_SENT)
                        log.warn("instagram reply failed", account=self.id, outbox=row["id"], sent=n, of=len(steps), code=log.code_of(err))
                        raise
                first_id = first_id or item_id
                if step is None:
                    self.store_sent_text(row, thread_row, thread_id, item_id, text)
            if self.store.settle(row["id"], first_id):
                log.info("instagram reply sent", account=self.id, outbox=row["id"], files=len(files))

    def store_sent_text(self, row: dict[str, Any], thread_row: dict[str, Any], thread_id: str, item_id: str, text: str) -> None:
        item = sent_item(item_id, self.viewer, text)
        t = Thread(id=thread_id, title=thread_row.get("group_name"), is_group=bool(thread_row.get("is_group")), people=[])
        try:
            self.store.ingest(self.id, [payload(self.store.sealer(self.user_id), t, item, self.viewer, live=True, unread=False)])
        except Exception as err:
            log.warn("store sent instagram failed", account=self.id, outbox=row["id"], code=log.code_of(err))

    def send_new(self, client: Any, row: dict[str, Any]) -> None:
        """A first message to a username: looked up, sent, stored, and the row pointed at the new thread.
        Instagram puts it in their requests unless they follow you, and gives the same thread back when one
        already exists, so a person is never started twice."""
        if row.get("account_id") != self.id or row.get("user_id") != self.user_id:
            return
        if not self.store.claim(row["id"]):
            return
        if (row.get("attachment_count") or 0) > 0:
            self.store.fail(row["id"], TEXT_ONLY)
            return
        text = self.store.body(row["user_id"], row.get("body")).strip()
        if not text:
            self.store.fail(row["id"], "There is nothing to send.")
            return
        addresses = row.get("to_addresses") or []
        username = username_of(self.store.address(row["user_id"], addresses[0])) if len(addresses) == 1 else ""
        if not USERNAME.match(username):
            self.store.fail(row["id"], BAD_USERNAME)
            return
        if username == self.username.lower():
            self.store.fail(row["id"], OWN_USERNAME)
            return
        cap = first_message_cap()
        if self.store.first_messages_since(self.id, datetime.now(timezone.utc) - timedelta(hours=24)) >= cap:
            self.store.fail(row["id"], DAILY_LIMIT.format(cap=cap))  # nothing is looked up or sent, and a failed row is not retried
            return
        try:
            # The private API's own lookup, not the public web one that blocks servers quickly.
            who = client.user_info_by_username_v1(username)
        except Exception as err:
            # Nothing has gone out yet, so a plain failure is safe to show; only an account-level problem stops the account.
            kind = kind_of(err)
            if type(err).__name__ == "UserNotFound":
                self.store.fail(row["id"], NO_SUCH_USER)
                return
            self.store.fail(row["id"], LOOKUP_FAILED)
            log.warn("instagram lookup failed", account=self.id, outbox=row["id"], code=log.code_of(err))
            if kind != "other":
                raise
            return
        pk = str(getattr(who, "pk", "") or "")
        if not pk.isdigit():
            self.store.fail(row["id"], NO_SUCH_USER)
            return
        if pk == self.viewer:
            self.store.fail(row["id"], OWN_USERNAME)
            return
        client.last_json = {}
        try:
            sent = client.direct_send(text, user_ids=[int(pk)])
            item_id = str(getattr(sent, "id", "") or "")
            thread_id = str(getattr(sent, "thread_id", "") or "")
        except Exception as err:
            sent_payload = (getattr(client, "last_json", None) or {}).get("payload") or {}
            item_id = "" if kind_of(err) != "other" else str(sent_payload.get("item_id") or "")
            thread_id = str(sent_payload.get("thread_id") or "")
            if not item_id:
                self.store.fail(row["id"], MAY_HAVE_SENT)
                log.warn("instagram new chat failed", account=self.id, outbox=row["id"], code=log.code_of(err))
                raise
        if self.store.settle(row["id"], item_id):
            log.info("instagram new chat sent", account=self.id, outbox=row["id"])
        if not thread_id.isdigit():
            thread_id = str(((getattr(client, "last_json", None) or {}).get("payload") or {}).get("thread_id") or "")
        if not thread_id.isdigit():
            log.warn("instagram new chat has no thread", account=self.id, outbox=row["id"])
            return  # the next poll finds the thread; the row stays unlinked
        item = sent_item(item_id, self.viewer, text)
        t = Thread(id=thread_id, title=None, is_group=False, people=[Person(pk, getattr(who, "username", None) or username, getattr(who, "full_name", None))])
        try:
            stored = self.store.ingest(self.id, [payload(self.store.sealer(self.user_id), t, item, self.viewer, live=True, unread=False)])
            stored_thread = (stored[0] if stored else {}).get("thread_id")
            if stored_thread:
                self.store.link_thread(row["id"], stored_thread)
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
