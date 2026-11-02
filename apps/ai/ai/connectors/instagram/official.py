"""One Business or Creator Instagram account on the official API (Instagram API with Instagram Login), in a
thread of its own like sync.AccountSync, and stored into the same tables through the same mapping.

The app saves an access token (web: /api/connect/instagram/official/callback). This reads the account's
conversations every minute or so (or at once on a webhook hint, see "Webhooks" below), sends the
replies you queued, and refreshes the token before its 60 days run out. No instagrapi, no proxy and no
password are involved. Only IDs, counts and error codes are ever logged.

The reply window (window.py): Instagram lets a Business account reply within 24 hours of the person's last
message, and only to someone who has written first. With the Human Agent feature granted to the app
(INSTAGRAM_HUMAN_AGENT), a reply you wrote yourself may go up to 7 days after, with the HUMAN_AGENT tag. Anything
later is refused here, before it is sent, with "reply in Instagram"; the app shows that on the unsent bubble and a
notice in the composer (components/instagram-window.tsx).

Webhooks (INSTAGRAM_WEBHOOKS): the web app's Meta webhook writes a content-free hint per event (hints.py,
meta_webhook_hints); the loop takes them every few seconds and reads the inbox at once, and the full poll slows to
a safety net. Without the flag it polls every minute or so, as before.
"""

from __future__ import annotations

import random
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from ... import log
from .backoff import Backoff, official_poll_wait, trouble
from .hints import has_news, human_agent_on, safety_wait, webhooks_on
from .graph import Graph, GraphError
from .mapping import Person, Thread, payload, sent_item
from .official_mapping import FALLBACK_FIELDS, FIELDS, thread as map_thread, time_us
from .store import OFFICIAL_SCOPE, Store, fetch
from .sync import MAY_HAVE_SENT, TEXT_ONLY, Settings
from .window import CLOSED, TAGGED, reply_mode

LOOP_S = 5.0  # the outbox and actions are checked this often; they are database reads until there is work
FIRST_PAGES = 2  # the first sync reads the 40 most recent conversations
PAGE_SIZE = 20
PAUSE_S = 1.0  # between reading one conversation and the next
HINT_PRUNE_S = 6 * 3600
MAX_TEXT_BYTES = 1000  # Meta's limit for one text message
REFRESH_BELOW_S = 20 * 24 * 3600  # a token with less than this left is refreshed (it must be a day old, and is 40 by now)
REFRESH_CHECK_S = 6 * 3600
EXPIRING_S = 3 * 24 * 3600

OUTSIDE_WINDOW = "Instagram only allows a reply within 24 hours of their last message. Send this one in Instagram."
TOO_LONG = "Instagram messages from Konva can be about 1,000 characters at most. Shorten it and send again."
NO_NEW_CHATS = "Instagram only lets a Business or Creator account message people who have messaged it first. Start this conversation in Instagram, or connect a personal account."
NOT_FOUND = "This conversation could not be found on Instagram."
REFUSED = "Instagram did not accept this reply. Send it in Instagram instead."
SIGNED_OUT = "Instagram signed Konva out. Connect again in Settings."
EXPIRING = "Konva could not renew its access to Instagram. Connect again in Settings within a few days."
FATAL = ("login", "permission")


def window_open(last_inbound_at: datetime | None, now: datetime, human_agent: bool = False) -> bool:
    """Whether a reply may still go out: they wrote within 24 hours, or within 7 days with Human Agent."""
    return reply_mode(last_inbound_at, now, human_agent) != CLOSED


def parse_time(value: Any) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


class OfficialSync:
    def __init__(
        self,
        store: Store,
        account: dict[str, Any],
        settings: Settings,
        stop: threading.Event,
        *,
        on_credentials: Callable[[str | None], None] = lambda _updated: None,  # parity with AccountSync: the token is saved in refreshed, which never moves updated_at
        make_graph: Callable[[str], Any] = Graph,
        rand: Callable[[], float] = random.random,
        clock: Callable[[], float] = time.monotonic,
        wall: Callable[[], float] = time.time,
        webhooks: bool | None = None,
        human_agent: bool | None = None,
    ):
        self.store = store
        self.account = account
        self.id = account["id"]
        self.user_id = account["user_id"]
        self.settings = settings
        self.stop = stop
        self.make_graph = make_graph
        self.rand = rand
        self.clock = clock
        self.wall = wall
        self.webhooks = webhooks_on() if webhooks is None else webhooks
        self.human_agent = human_agent_on() if human_agent is None else human_agent
        self.next_prune = 0.0
        self.backoff = Backoff(rand)
        self.viewer = ""
        self.expires_at = 0.0
        self.next_refresh_check = 0.0
        self.paused_until = 0.0
        self.connected = False
        self.names: dict[str, Person] = {}  # who each IGSID is, asked of Instagram once per run

    # -- starting ---------------------------------------------------------------------------------------

    def run(self) -> None:
        try:
            graph = self.connect()
            if graph is not None:
                self.loop(graph)
        except Exception as err:
            log.error("instagram account failed", account=self.id, code=log.code_of(err))
            self.store.set_status(self.account, "error", "Instagram sync stopped after an error. Connect again in Settings.")

    def connect(self) -> Any:
        """A client for the saved token, with no request at all. None when the account stopped instead."""
        creds, refreshed = self.store.credentials(self.id)
        # The token the connector last refreshed wins over the one the app saved; reconnecting clears it.
        saved = refreshed if refreshed and refreshed.get("kind") == "official" and refreshed.get("accessToken") else creds
        if not creds or not saved or not saved.get("accessToken") or not creds.get("userId"):
            self.store.set_status(self.account, "error", "Connect Instagram again in Settings.")
            return None
        self.viewer = str(creds["userId"])
        self.expires_at = float(saved.get("expiresAt") or 0)
        if self.expires_at and self.wall() >= self.expires_at:
            self.store.set_status(self.account, "error", SIGNED_OUT)
            return None
        return self.make_graph(str(saved["accessToken"]))

    # -- the loop ---------------------------------------------------------------------------------------

    def loop(self, graph: Any) -> None:
        quiet_since = self.clock()
        next_poll = self.clock()
        if self.store.newest_seen(self.id, OFFICIAL_SCOPE) is None:
            self.store.set_status(self.account, "syncing", "Importing your recent Instagram chats.")
        while not self.stop.is_set():
            try:
                if self.clock() >= self.paused_until:
                    self.send_outbox(graph)
                    self.apply_actions()
                self.refresh_token(graph)
                if self.webhooks and self.take_hints():
                    next_poll = self.clock()  # Meta says there is news: read the inbox now
                if self.clock() >= next_poll:
                    stored = self.poll(graph)
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
                    wait = safety_wait if self.webhooks else official_poll_wait
                    next_poll = self.clock() + wait(self.clock() - quiet_since, self.rand)
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

    # -- webhook hints ----------------------------------------------------------------------------------

    def take_hints(self) -> bool:
        """Whether Meta's webhook left news for this account. A failed read only costs the faster path: the safety
        poll still finds it."""
        try:
            hints = self.store.take_hints(self.viewer)
            if self.clock() >= self.next_prune:
                self.next_prune = self.clock() + HINT_PRUNE_S
                self.store.prune_hints()
        except Exception as err:
            log.warn("instagram hints failed", account=self.id, code=log.code_of(err))
            return False
        return bool(hints) and has_news(hints)

    # -- the token --------------------------------------------------------------------------------------

    def refresh_token(self, graph: Any) -> None:
        """Swaps the token for a fresh 60 days while it still has under 20 left, checked every few hours. A
        token that could not be renewed and is about to end tells you, while there is time to connect again."""
        now = self.wall()
        if now < self.next_refresh_check:
            return
        self.next_refresh_check = now + REFRESH_CHECK_S
        if self.expires_at and self.expires_at - now > REFRESH_BELOW_S:
            return
        try:
            renewed = graph.refresh()
            token, lasts = renewed.get("access_token"), int(renewed.get("expires_in") or 0)
        except GraphError as err:
            if err.kind in FATAL:
                raise
            token, lasts = None, 0
            log.warn("instagram token refresh failed", account=self.id, code=log.code_of(err))
        if not token or lasts <= 0:
            if self.expires_at and self.expires_at - now < EXPIRING_S:
                self.store.set_detail(self.id, EXPIRING)
            return
        graph.token = str(token)
        self.expires_at = now + lasts
        self.store.save_token(self.id, str(token), int(self.expires_at))
        log.info("instagram token refreshed", account=self.id, days=lasts // 86400)

    # -- reading ----------------------------------------------------------------------------------------

    def poll(self, graph: Any) -> int:
        """Reads the inbox and stores what is new. Returns how many new messages from others were stored."""
        newest = self.store.newest_seen(self.id, OFFICIAL_SCOPE)
        first = newest is None
        conversations: list[dict[str, Any]] = []
        after = None
        for _ in range(FIRST_PAGES if first else 1):
            page = graph.conversations(PAGE_SIZE, after)
            conversations.extend(c for c in page.get("data") or [] if isinstance(c, dict))
            after = ((page.get("paging") or {}).get("cursors") or {}).get("after") if (page.get("paging") or {}).get("next") else None
            if not after:
                break
            self.pause()

        sealer = self.store.sealer(self.user_id)
        stored = 0
        latest = newest or 0
        for c in conversations:
            # Read again while it is level with the newest message already stored: times have whole seconds, and
            # a message in the same second as the last one stored must not be missed. Stored twice is harmless.
            if newest is not None and time_us(c.get("updated_time")) < newest:
                continue
            self.pause()
            try:
                t = self.read(graph, c)
            except GraphError as err:
                if err.kind != "other" or err.ambiguous:
                    raise
                log.warn("instagram conversation failed", account=self.id, code=err.code)  # one that cannot be read must not hide the rest
                continue
            if not t or not t.items:
                continue
            latest = max(latest, t.items[0].timestamp_us)
            stored += self.store_conversation(sealer, t, newest)
        if latest and latest != newest:
            self.store.save_newest(self.id, latest, OFFICIAL_SCOPE)
        if stored:
            log.info("instagram messages stored", account=self.id, threads=len(conversations), inserted=stored)
        return stored

    def read(self, graph: Any, conversation: dict[str, Any]) -> Thread | None:
        """One conversation with its newest messages. Instagram only returns the 20 newest; a field it refuses
        (error 100) is retried with the plain ones, so a change on their side costs files and quotes, not the sync."""
        try:
            messages = graph.messages(str(conversation.get("id")), FIELDS)
        except GraphError as err:
            if not err.invalid_field:
                raise
            messages = graph.messages(str(conversation.get("id")), FALLBACK_FIELDS)
        t = map_thread(conversation, messages, self.viewer)
        if t:
            t.people = [self.person(graph, p) for p in t.people]
        return t

    def person(self, graph: Any, who: Person) -> Person:
        """A person with their full name when Instagram will say it (they have messaged this account, so it usually does)."""
        if who.pk in self.names:
            return self.names[who.pk]
        found = who
        try:
            profile = graph.profile(who.pk)
            found = Person(who.pk, str(profile.get("username") or who.username or "") or None, str(profile.get("name") or "").strip() or None)
        except GraphError as err:
            if err.kind in ("login", "rate", "feedback", "network"):
                raise
        self.names[who.pk] = found
        return found

    def store_conversation(self, sealer: Any, t: Thread, newest: int | None) -> int:
        live = newest is not None
        # Level with the newest stored counts as well (see poll); the same message is only ever stored once.
        items = [i for i in reversed(t.items) if newest is None or i.timestamp_us >= newest]
        payloads = []
        for i in items:
            p = payload(sealer, t, i, self.viewer, live=live, unread=live and i.sender_pk != self.viewer)
            p["provider_meta"].pop("receipt", None)  # nothing tells Instagram you saw it: its API has no read receipt for this
            payloads.append(p)
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
            if item.media and attachment and (live or item.sent_at >= since):
                self.save_file(item.media, result["message_id"], attachment)
        return stored

    def save_file(self, media: Any, message_id: str, attachment_id: str) -> None:
        try:
            data = fetch(media.url, None, None)
            if data is not None:
                self.store.save_file(self.user_id, message_id, attachment_id, data, media.mime_type, media.kind, self.id)
        except Exception as err:  # the message is stored either way; a lost file is not worth stopping for
            log.warn("instagram file failed", account=self.id, attachment=attachment_id, code=log.code_of(err))

    def pause(self) -> None:
        self.stop.wait(PAUSE_S)

    # -- sending ----------------------------------------------------------------------------------------

    def send_outbox(self, graph: Any) -> None:
        """Sends replies you queued in the app, one at a time, each claimed first so it never goes twice."""
        for row in self.store.queued_outbox(self.id):
            if self.stop.is_set():
                return
            self.send(graph, row)
        # The official API can only answer someone who wrote first, so a new conversation can never go: say so.
        for row in self.store.queued_new_chats(self.id):
            if row.get("account_id") == self.id and row.get("user_id") == self.user_id and self.store.claim(row["id"]):
                self.store.fail(row["id"], NO_NEW_CHATS)

    def send(self, graph: Any, row: dict[str, Any]) -> None:
        thread_row = row.get("threads") or {}
        if thread_row.get("account_id") != self.id or thread_row.get("user_id") != row.get("user_id") or thread_row.get("channel") != "instagram":
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
        if len(text.encode("utf-8")) > MAX_TEXT_BYTES:
            self.store.fail(row["id"], TOO_LONG)
            return
        # The window and the person to answer both come from their last message in this conversation.
        last = self.store.last_inbound(row["thread_id"])
        mode = reply_mode(parse_time(last.get("sent_at")) if last else None, datetime.now(timezone.utc), self.human_agent)
        if not last or mode == CLOSED:
            self.store.fail(row["id"], OUTSIDE_WINDOW)
            return
        recipient = self.store.address(row["user_id"], last.get("sender_address"))
        conversation = self.store.address(row["user_id"], thread_row.get("provider_thread_id"))
        if not recipient.isdigit() or not conversation:
            self.store.fail(row["id"], NOT_FOUND)
            return
        try:
            sent = graph.send(recipient, text, human_agent=True) if mode == TAGGED else graph.send(recipient, text)
        except GraphError as err:
            log.warn("instagram reply failed", account=self.id, outbox=row["id"], code=err.code)
            if err.outside_window:
                self.store.fail(row["id"], OUTSIDE_WINDOW)
            elif err.ambiguous:
                self.store.fail(row["id"], MAY_HAVE_SENT)
                raise
            elif err.kind in FATAL:
                self.store.fail(row["id"], SIGNED_OUT if err.kind == "login" else REFUSED)
                raise
            elif err.kind == "rate":
                self.store.fail(row["id"], "Instagram asked Konva to slow down. Try again in a little while.")
                raise
            else:
                self.store.fail(row["id"], REFUSED)
            return
        item_id = str(sent.get("message_id") or "")
        if not item_id:
            self.store.fail(row["id"], MAY_HAVE_SENT)
            return
        if self.store.settle(row["id"], item_id):
            log.info("instagram reply sent", account=self.id, outbox=row["id"])
        item = sent_item(item_id, self.viewer, text)
        t = Thread(id=conversation, title=None, is_group=False, people=[])
        try:
            p = payload(self.store.sealer(self.user_id), t, item, self.viewer, live=True, unread=False)
            self.store.ingest(self.id, [p])
        except Exception as err:
            log.warn("store sent instagram failed", account=self.id, outbox=row["id"], code=log.code_of(err))

    # -- actions ----------------------------------------------------------------------------------------

    def apply_actions(self) -> None:
        """Archiving and the rest stay in the app. Opening a thread cannot be told to Instagram (the official
        API has no read receipt for this) and reactions are not sent yet."""
        for row in self.store.queued_actions(self.id):
            if row.get("action") == "react":
                self.store.finish_action(row["id"], "Reactions are not sent to Instagram yet.")
            else:
                self.store.finish_action(row["id"])
