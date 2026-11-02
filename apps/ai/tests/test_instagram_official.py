"""The Instagram connector's official side (Business and Creator accounts) on hand-written API responses:
no network, no database, no instagrapi. The responses follow Meta's Conversation and Message references."""

import base64
import json
import threading
import unittest
import urllib.request
from datetime import datetime, timedelta, timezone

from ai.connectors.instagram import backoff, credentials, official_mapping as om, run
from ai.connectors.instagram.graph import Graph, GraphError
from ai.connectors.instagram.mapping import Person
from ai.connectors.instagram.sealing import AccountSealer, open_json
from ai.connectors.instagram.official import (
    FATAL, MAX_TEXT_BYTES, NO_NEW_CHATS, NOT_FOUND, OUTSIDE_WINDOW, REFRESH_BELOW_S, REFUSED, TOO_LONG, OfficialSync, window_open,
)
from ai.connectors.instagram.store import OFFICIAL_SCOPE, STATE_SCOPE, Store
from ai.connectors.instagram.sync import MAY_HAVE_SENT, TEXT_ONLY, Settings
from tests.test_instagram import FakeSealer, FakeStore

ME = "17841400000000001"
ANA = "9000000000000001"
NOW = datetime(2026, 10, 27, 12, 0, tzinfo=timezone.utc)


def message(n, sender=ANA, text="Hello", **extra):
    """A message as the conversation's messages edge returns it: n minutes after 10:00 UTC."""
    at = datetime(2026, 10, 26, 10, 0, tzinfo=timezone.utc) + timedelta(minutes=n)
    return {"id": f"mid{n}", "created_time": at.strftime("%Y-%m-%dT%H:%M:%S+0000"), "from": {"id": sender, "username": "ana.m" if sender == ANA else "me"}, "message": text, **extra}


def conversation(**extra):
    return {"id": "conv1", "updated_time": "2026-10-26T11:00:00+0000", "participants": {"data": [{"id": ANA, "username": "ana.m"}, {"id": ME, "username": "mybusiness"}]}, **extra}


def edge(*messages):
    return {"messages": {"data": list(messages)}, "id": "conv1"}


def us(n):
    return om.time_us(message(n)["created_time"])


class Times(unittest.TestCase):
    def test_iso_and_unix(self):
        at = int(datetime(2026, 10, 26, 10, 0, tzinfo=timezone.utc).timestamp())
        self.assertEqual(om.time_us("2026-10-26T10:00:00+0000"), at * 1_000_000)
        self.assertEqual(om.time_us(at), at * 1_000_000)
        self.assertEqual(om.time_us(str(at)), at * 1_000_000)
        self.assertEqual(om.time_us(at * 1000), at * 1_000_000)
        self.assertEqual(om.time_us("nonsense"), 0)
        self.assertEqual(om.time_us(None), 0)


class Messages(unittest.TestCase):
    def test_text(self):
        i = om.describe(message(1, text="Is the flat still available?"))
        self.assertEqual((i.id, i.sender_pk, i.text, i.preview, i.media), ("mid1", ANA, "Is the flat still available?", "Is the flat still available?", None))

    def test_photo_video_sticker_gif_and_voice(self):
        photo = om.describe(message(1, text="", attachments={"data": [{"id": "a", "image_data": {"url": "https://cdn/p.jpg", "width": 100, "height": 100}}]}))
        self.assertEqual((photo.preview, photo.media.kind, photo.media.url), ("Photo", "image", "https://cdn/p.jpg"))
        video = om.describe(message(1, text="", attachments={"data": [{"video_data": {"url": "https://cdn/v.mp4"}}]}))
        self.assertEqual((video.preview, video.media.kind), ("Video", "video"))
        sticker = om.describe(message(1, text="", attachments={"data": [{"image_data": {"url": "https://cdn/s.png", "render_as_sticker": True}}]}))
        self.assertEqual(sticker.preview, "Sticker")
        gif = om.describe(message(1, text="", attachments={"data": [{"image_data": {"url": "https://cdn/g.jpg", "animated_gif_url": "https://cdn/g.gif"}}]}))
        self.assertEqual((gif.preview, gif.media.mime_type), ("GIF", "image/gif"))
        voice = om.describe(message(1, text="", attachments={"data": [{"file_url": "https://cdn/voice.m4a?sig=1"}]}))
        self.assertEqual((voice.preview, voice.media.filename, voice.media.kind), ("Voice Note", "Voice Note.m4a", "audio"))

    def test_a_file_it_cannot_read_is_said_plainly(self):
        i = om.describe(message(1, text="", attachments={"data": [{"file_url": "https://cdn/thing.pdf"}]}))
        self.assertTrue(i.unsupported)
        self.assertEqual(i.text, om.UNSUPPORTED)
        self.assertIsNone(i.media)
        self.assertTrue(om.describe(message(1, text="", is_unsupported=True)).unsupported)

    def test_shares_and_stories_become_links(self):
        share = om.describe(message(1, text="", shares={"data": [{"type": "ig_reel", "url": "https://www.instagram.com/reel/abc/"}]}))
        self.assertEqual((share.preview, share.text), ("Shared Reel", "https://www.instagram.com/reel/abc/"))
        mention = om.describe(message(1, text="", story={"mention": {"link": "https://lookaside/story", "id": "1"}}))
        self.assertEqual(mention.preview, "Mentioned You in Their Story")
        reply = om.describe(message(1, text="Love it", story={"reply_to": {"link": "https://lookaside/story", "id": "1"}}))
        self.assertEqual(reply.preview, "Replied to a Story: Love it")
        self.assertEqual(reply.text, "Love it\nhttps://lookaside/story")

    def test_no_id_is_no_message(self):
        self.assertIsNone(om.describe({"message": "x"}))

    def test_replies_quote_only_what_is_in_the_batch(self):
        t = om.thread(conversation(), edge(message(1, text="Can you do Friday?"), message(2, sender=ME, text="Yes", reply_to={"mid": "mid1"}), message(3, text="Late", reply_to={"mid": "gone"})), ME)
        by_id = {i.id: i for i in t.items}
        self.assertEqual((by_id["mid2"].quoted.id, by_id["mid2"].quoted.text, by_id["mid2"].quoted.sender_pk), ("mid1", "Can you do Friday?", ANA))
        self.assertIsNone(by_id["mid3"].quoted)


class Threads(unittest.TestCase):
    def test_newest_first_and_only_the_other_person(self):
        t = om.thread(conversation(), edge(message(1), message(2, sender=ME, text="Hi"), message(3, text="Thanks")), ME)
        self.assertEqual([i.id for i in t.items], ["mid3", "mid2", "mid1"])
        self.assertEqual([(p.pk, p.username) for p in t.people], [(ANA, "ana.m")])
        self.assertFalse(t.is_group)
        self.assertEqual(t.id, "conv1")

    def test_who_wrote_stands_in_for_empty_participants(self):
        t = om.thread({"id": "conv1"}, edge(message(1), message(2, sender=ME)), ME)
        self.assertEqual([(p.pk, p.username) for p in t.people], [(ANA, "ana.m")])

    def test_messages_without_a_time_are_dropped(self):
        t = om.thread(conversation(), edge({**message(1), "created_time": "soon"}, message(2)), ME)
        self.assertEqual([i.id for i in t.items], ["mid2"])


class Credentials(unittest.TestCase):
    def test_kind_defaults_to_private(self):
        self.assertEqual(credentials.kind_of({"kind": "official", "accessToken": "t"}), "official")
        self.assertEqual(credentials.kind_of({"kind": "private", "username": "a"}), "private")
        self.assertEqual(credentials.kind_of({"username": "a", "password": "p"}), "private")  # saved before there was a kind
        self.assertEqual(credentials.kind_of(None), "private")

    def test_own_proxy_wins_over_the_global_one(self):
        self.assertEqual(credentials.proxy_for({"proxy": "http://u:p@h:1"}, "http://global:2"), "http://u:p@h:1")
        self.assertEqual(credentials.proxy_for({"proxy": "socks5h://h:1"}, None), "socks5h://h:1")
        self.assertEqual(credentials.proxy_for({"username": "a"}, "http://global:2"), "http://global:2")
        self.assertEqual(credentials.proxy_for({"proxy": "  "}, "http://global:2"), "http://global:2")
        self.assertEqual(credentials.proxy_for({"proxy": "ftp://nope"}, "http://global:2"), "http://global:2")  # not a proxy address
        self.assertIsNone(credentials.proxy_for(None, None))

    def test_a_proxy_survives_the_password_being_dropped(self):
        class Db:
            def __init__(self):
                self.patch = None

            def update(self, table, where, patch, minimal=False):
                self.patch = patch
                return [{"updated_at": "t"}]

        class Vault:
            def credential_key_for(self, user_id):
                return bytes(range(32))

        store = Store.__new__(Store)
        store.db, store.encryption_key = Db(), base64.b64encode(b"k" * 32).decode()
        store.creds = AccountSealer(store.db, Vault(), store.encryption_key)
        store.creds._owners["a1"] = "u1"
        store.forget_password("a1", "ana", "http://u:p@h:1")
        self.assertEqual(store.creds.open("a1", store.db.patch["ciphertext"]), {"kind": "private", "username": "ana", "proxy": "http://u:p@h:1"})
        store.forget_password("a1", "ana")
        self.assertEqual(store.creds.open("a1", store.db.patch["ciphertext"]), {"kind": "private", "username": "ana"})


class Calls(unittest.TestCase):
    def graph(self, status=200, body=None, raises=None):
        seen = []

        def open_(request: urllib.request.Request):
            seen.append(request)
            if raises:
                raise raises
            return status, json.dumps(body if body is not None else {}).encode()

        return Graph("TOKEN", open_), seen

    def test_token_goes_in_a_header_not_the_address(self):
        g, seen = self.graph(body={"data": []})
        g.conversations(20, "cursor1")
        r = seen[0]
        self.assertEqual(r.get_header("Authorization"), "Bearer TOKEN")
        self.assertNotIn("TOKEN", r.full_url)
        self.assertTrue(r.full_url.startswith("https://graph.instagram.com/v25.0/me/conversations?"))
        self.assertIn("platform=instagram", r.full_url)
        self.assertIn("after=cursor1", r.full_url)

    def test_messages_expand_in_one_request(self):
        g, seen = self.graph(body=edge())
        g.messages("conv1", "id,message", 20)
        self.assertIn("/conv1?", seen[0].full_url)
        self.assertIn("messages.limit%2820%29%7Bid%2Cmessage%7D", seen[0].full_url)

    def test_send_posts_json_to_me_messages(self):
        g, seen = self.graph(body={"recipient_id": ANA, "message_id": "m1"})
        self.assertEqual(g.send(ANA, "See you at 10")["message_id"], "m1")
        r = seen[0]
        self.assertEqual((r.get_method(), r.full_url), ("POST", "https://graph.instagram.com/v25.0/me/messages"))
        self.assertEqual(json.loads(r.data), {"recipient": {"id": ANA}, "message": {"text": "See you at 10"}})
        self.assertEqual(r.get_header("Content-type"), "application/json")

    def test_refresh_is_unversioned(self):
        g, seen = self.graph(body={"access_token": "NEW", "token_type": "bearer", "expires_in": 5_183_944})
        g.refresh()
        self.assertTrue(seen[0].full_url.startswith("https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token"))

    def test_errors_are_told_apart_by_code(self):
        cases = [
            (400, {"code": 190}, "login"), (401, {}, "login"), (400, {"code": 10}, "permission"), (403, {}, "permission"),
            (400, {"code": 4}, "rate"), (429, {}, "rate"), (400, {"code": 613}, "rate"), (400, {"code": 368}, "feedback"),
            (400, {"code": 100}, "other"), (500, {}, "network"),
        ]
        for status, error, kind in cases:
            g, _ = self.graph(status, {"error": {"message": "secret words", **error}})
            with self.assertRaises(GraphError) as caught:
                g.me()
            self.assertEqual(caught.exception.kind, kind, (status, error))
            self.assertNotIn("secret", str(caught.exception))
            self.assertEqual(backoff.kind_of(caught.exception), kind)
        self.assertTrue(backoff.trouble(GraphError(400, 10, None, "permission")).stop)

    def test_a_200_with_an_error_is_an_error(self):
        g, _ = self.graph(200, {"error": {"code": 190}})
        with self.assertRaises(GraphError):
            g.me()

    def test_the_window_error_and_invalid_fields(self):
        g, _ = self.graph(400, {"error": {"code": 10, "error_subcode": 2534022}})
        with self.assertRaises(GraphError) as caught:
            g.send(ANA, "x")
        self.assertTrue(caught.exception.outside_window)
        self.assertFalse(backoff.trouble(caught.exception).stop)  # a reply refused is not an account problem
        g, _ = self.graph(400, {"error": {"code": 100}})
        with self.assertRaises(GraphError) as caught:
            g.messages("c", "x")
        self.assertTrue(caught.exception.invalid_field)

    def test_a_lost_connection_may_have_been_taken(self):
        g, _ = self.graph(raises=TimeoutError())
        with self.assertRaises(GraphError) as caught:
            g.send(ANA, "x")
        self.assertEqual((caught.exception.kind, caught.exception.ambiguous), ("network", True))
        g, _ = self.graph(500, {})
        with self.assertRaises(GraphError) as caught:
            g.send(ANA, "x")
        self.assertTrue(caught.exception.ambiguous)

    def test_polls_are_sooner_than_a_personal_accounts(self):
        mid = lambda: 0.5
        self.assertEqual(backoff.official_poll_wait(0, mid), 60)
        self.assertEqual(backoff.official_poll_wait(45 * 60, mid), 180)
        self.assertEqual(backoff.official_poll_wait(5 * 3600, mid), 600)


class OfficialStore(FakeStore):
    def __init__(self, *args, last=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.last, self.scopes, self.tokens, self.details = last, [], [], []

    def newest_seen(self, account_id, scope=STATE_SCOPE):
        self.scopes.append(scope)
        return self.newest

    def save_newest(self, account_id, ts, scope=STATE_SCOPE):
        self.scopes.append(scope)
        self.newest = ts

    def last_inbound(self, thread_id):
        return self.last

    def save_token(self, account_id, token, expires_at):
        self.tokens.append((token, expires_at))

    def set_detail(self, account_id, detail):
        self.details.append(detail)

    def touch(self, account_id):
        pass

    def credentials(self, account_id):
        return None, None


class FakeGraph:
    def __init__(self, pages=(), edges=None, send=None, refresh=None, profiles=None):
        self.pages = list(pages)
        self.edges = edges or {}
        self.send_result, self.refresh_result, self.profiles = send, refresh, profiles or {}
        self.token = "T0"
        self.sent, self.calls = [], []

    def conversations(self, limit=20, after=None):
        self.calls.append(("conversations", after))
        return self.pages.pop(0)

    def messages(self, conversation_id, fields, limit=20):
        self.calls.append(("messages", fields))
        result = self.edges[conversation_id]
        if isinstance(result, Exception):
            raise result
        return result

    def profile(self, igsid):
        self.calls.append(("profile", igsid))
        found = self.profiles.get(igsid)
        if isinstance(found, Exception):
            raise found
        return found or {}

    def send(self, recipient, text, human_agent=False):
        self.sent.append((recipient, text, True) if human_agent else (recipient, text))
        if isinstance(self.send_result, Exception):
            raise self.send_result
        return self.send_result

    def refresh(self):
        self.calls.append(("refresh",))
        if isinstance(self.refresh_result, Exception):
            raise self.refresh_result
        return self.refresh_result


def outbox_row(**extra):
    return {
        "id": "o1", "user_id": "u1", "body": "See you at 10", "attachment_count": 0, "thread_id": "t1",
        "threads": {"account_id": "a1", "channel": "instagram", "user_id": "u1", "provider_thread_id": "conv1", "is_group": False, "group_name": None},
        **extra,
    }


def official(store, wall=lambda: 1_000_000.0):
    sync = OfficialSync(store, {"id": "a1", "user_id": "u1"}, Settings(proxy=None, initial_sync_days=30), threading.Event(), rand=lambda: 0.5, wall=wall)
    sync.viewer = ME
    sync.pause = lambda: None
    return sync


class Window(unittest.TestCase):
    def test_a_reply_goes_out_for_24_hours(self):
        self.assertTrue(window_open(NOW - timedelta(hours=23, minutes=59), NOW))
        self.assertFalse(window_open(NOW - timedelta(hours=24), NOW))
        self.assertFalse(window_open(NOW - timedelta(days=3), NOW))
        self.assertFalse(window_open(None, NOW))


class Sending(unittest.TestCase):
    def recent(self, hours=2):
        return {"sent_at": (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat(), "sender_address": ANA}

    def test_inside_the_window_the_reply_goes_to_who_wrote(self):
        store, graph = OfficialStore([outbox_row()], last=self.recent()), FakeGraph(send={"recipient_id": ANA, "message_id": "mid99"})
        official(store).send_outbox(graph)
        self.assertEqual(graph.sent, [(ANA, "See you at 10")])
        self.assertEqual(store.settled, [("o1", "mid99")])
        self.assertEqual(store.failed, [])
        self.assertEqual((store.ingested[0]["provider_message_id"], store.ingested[0]["direction"]), ("mid99", "outbound"))
        self.assertEqual(store.ingested[0]["chat_jid"], "A(conv1)")  # the conversation it was read from, sealed like any address

    def test_outside_the_window_nothing_is_sent(self):
        for last in (self.recent(hours=30), None):
            store, graph = OfficialStore([outbox_row()], last=last), FakeGraph()
            official(store).send_outbox(graph)
            self.assertEqual(store.failed, [("o1", OUTSIDE_WINDOW)])
            self.assertEqual(graph.sent, [])
        self.assertIn("Send this one in Instagram", OUTSIDE_WINDOW)
        self.assertNotIn("—", OUTSIDE_WINDOW)

    def test_the_api_refusing_for_the_window_is_the_same_message(self):
        store = OfficialStore([outbox_row()], last=self.recent())
        graph = FakeGraph(send=GraphError(400, 10, 2534022, "other"))
        official(store).send_outbox(graph)  # not raised: the account is fine
        self.assertEqual(store.failed, [("o1", OUTSIDE_WINDOW)])

    def test_files_long_text_and_other_accounts_are_not_sent(self):
        store, graph = OfficialStore([outbox_row(attachment_count=1)], last=self.recent()), FakeGraph()
        official(store).send_outbox(graph)
        self.assertEqual(store.failed, [("o1", TEXT_ONLY)])
        store = OfficialStore([outbox_row(body="é" * (MAX_TEXT_BYTES // 2 + 1))], last=self.recent())
        official(store).send_outbox(graph)
        self.assertEqual(store.failed, [("o1", TOO_LONG)])
        other = outbox_row()
        other["threads"] = {**other["threads"], "account_id": "a2"}
        store = OfficialStore([other], last=self.recent())
        official(store).send_outbox(graph)
        self.assertEqual((store.claimed, graph.sent), ([], []))

    def test_a_recipient_that_is_not_an_id_is_not_sent(self):
        store, graph = OfficialStore([outbox_row()], last={**self.recent(), "sender_address": None}), FakeGraph()
        official(store).send_outbox(graph)
        self.assertEqual(store.failed, [("o1", NOT_FOUND)])

    def test_a_lost_answer_is_never_retried(self):
        store, graph = OfficialStore([outbox_row()], last=self.recent()), FakeGraph(send=GraphError(0, None, None, "network", ambiguous=True))
        with self.assertRaises(GraphError):
            official(store).send_outbox(graph)
        self.assertEqual(store.failed, [("o1", MAY_HAVE_SENT)])
        self.assertEqual(store.settled, [])

    def test_a_signed_out_token_stops_the_account(self):
        store, graph = OfficialStore([outbox_row()], last=self.recent()), FakeGraph(send=GraphError(400, 190, None, "login"))
        with self.assertRaises(GraphError):
            official(store).send_outbox(graph)
        self.assertEqual(len(store.failed), 1)
        self.assertIn("login", FATAL)

    def test_any_other_refusal_is_a_plain_reason_and_the_account_carries_on(self):
        store, graph = OfficialStore([outbox_row()], last=self.recent()), FakeGraph(send=GraphError(400, 100, None, "other"))
        official(store).send_outbox(graph)
        self.assertEqual(store.failed, [("o1", REFUSED)])

    def test_an_answer_without_an_id_is_not_taken_as_sent(self):
        store, graph = OfficialStore([outbox_row()], last=self.recent()), FakeGraph(send={})
        official(store).send_outbox(graph)
        self.assertEqual(store.failed, [("o1", MAY_HAVE_SENT)])


class NewChats(unittest.TestCase):
    def test_a_new_conversation_fails_plainly_and_nothing_is_sent(self):
        row = {"id": "n1", "user_id": "u1", "account_id": "a1", "body": "Hi", "attachment_count": 0, "to_addresses": ["ana.m"]}
        store, graph = OfficialStore(new_chats=[row]), FakeGraph()
        official(store).send_outbox(graph)
        self.assertEqual(store.failed, [("n1", NO_NEW_CHATS)])
        self.assertEqual(graph.sent, [])

    def test_another_accounts_row_is_left_alone(self):
        row = {"id": "n1", "user_id": "u1", "account_id": "a2", "to_addresses": ["ana.m"]}
        store = OfficialStore(new_chats=[row])
        official(store).send_outbox(FakeGraph())
        self.assertEqual((store.claimed, store.failed), ([], []))


class Polling(unittest.TestCase):
    def page(self, *conversations, after=None):
        return {"data": list(conversations), **({"paging": {"cursors": {"after": after}, "next": "https://graph.instagram.com/next"}} if after else {})}

    def test_first_poll_imports_history_quietly_under_its_own_scope(self):
        store = OfficialStore()
        graph = FakeGraph([self.page(conversation())], {"conv1": edge(message(1, text="Hello"), message(2, sender=ME, text="Hi"))}, profiles={ANA: {"name": "Ana Mokoena", "username": "ana.m"}})
        stored = official(store).poll(graph)
        self.assertEqual(stored, 1)
        self.assertEqual([p["provider_message_id"] for p in store.ingested], ["mid1", "mid2"])  # oldest first
        self.assertFalse(any(p["resurface"] for p in store.ingested))
        self.assertTrue(all(p["is_read"] for p in store.ingested))
        self.assertEqual(store.newest, us(2))
        self.assertEqual(set(store.scopes), {OFFICIAL_SCOPE})
        self.assertEqual(store.ingested[0]["participants"][0]["display_name"], "Ana Mokoena")
        self.assertEqual(store.ingested[0]["direction"], "inbound")
        self.assertEqual(store.ingested[1]["direction"], "outbound")

    def test_later_polls_resurface_new_messages_with_no_receipt_to_send(self):
        store = OfficialStore()
        store.newest = us(1)
        graph = FakeGraph([self.page(conversation(updated_time="2026-10-26T10:05:00+0000"))], {"conv1": edge(message(1), message(2, text="New one"))})
        official(store).poll(graph)
        self.assertEqual([p["provider_message_id"] for p in store.ingested], ["mid1", "mid2"])  # level with the newest is read again
        new = store.ingested[1]
        self.assertTrue(new["resurface"])
        self.assertFalse(new["is_read"])
        self.assertNotIn("receipt", new["provider_meta"])
        self.assertEqual(len([c for c in graph.calls if c[0] == "conversations"]), 1)

    def test_quiet_conversations_are_not_opened(self):
        store = OfficialStore()
        store.newest = om.time_us("2026-10-26T11:30:00+0000")  # after the conversation's last activity
        graph = FakeGraph([self.page(conversation())], {})
        official(store).poll(graph)
        self.assertEqual(store.ingested, [])
        self.assertNotIn("messages", [c[0] for c in graph.calls])

    def test_the_first_poll_reads_two_pages(self):
        store = OfficialStore()
        second = {**conversation(id="conv2"), "participants": {"data": [{"id": "9000000000000002", "username": "ben"}]}}
        graph = FakeGraph([self.page(conversation(), after="c1"), self.page(second)], {"conv1": edge(message(1)), "conv2": edge(message(2, sender="9000000000000002"))})
        official(store).poll(graph)
        self.assertEqual([c for c in graph.calls if c[0] == "conversations"], [("conversations", None), ("conversations", "c1")])
        self.assertEqual(len(store.ingested), 2)

    def test_a_refused_field_is_retried_with_the_plain_ones(self):
        store = OfficialStore()

        class Picky(FakeGraph):
            def messages(self, conversation_id, fields, limit=20):
                self.calls.append(("messages", fields))
                if fields == om.FIELDS:
                    raise GraphError(400, 100, None, "other")
                return edge(message(1))

        graph = Picky([self.page(conversation())])
        official(store).poll(graph)
        self.assertEqual([c[1] for c in graph.calls if c[0] == "messages"], [om.FIELDS, om.FALLBACK_FIELDS])
        self.assertEqual(len(store.ingested), 1)

    def test_one_unreadable_conversation_does_not_hide_the_rest(self):
        store = OfficialStore()
        second = {**conversation(id="conv2"), "participants": {"data": [{"id": "9000000000000002"}]}}
        graph = FakeGraph([self.page(conversation(), second)], {"conv1": GraphError(400, 2, None, "other"), "conv2": edge(message(2, sender="9000000000000002"))})
        official(store).poll(graph)
        self.assertEqual([p["provider_message_id"] for p in store.ingested], ["mid2"])

    def test_a_signed_out_token_is_not_swallowed(self):
        graph = FakeGraph([self.page(conversation())], {"conv1": GraphError(400, 190, None, "login")})
        with self.assertRaises(GraphError):
            official(OfficialStore()).poll(graph)

    def test_a_name_instagram_will_not_give_falls_back_to_the_username(self):
        store = OfficialStore()
        graph = FakeGraph([self.page(conversation())], {"conv1": edge(message(1))}, profiles={ANA: GraphError(400, 10, None, "permission")})
        sync = official(store)
        sync.poll(graph)
        self.assertEqual(store.ingested[0]["participants"][0]["handle"], "ana.m")
        self.assertIsNone(store.ingested[0]["participants"][0]["display_name"])
        self.assertEqual(sync.names[ANA], Person(ANA, "ana.m", None))

    def test_actions_stay_in_the_app(self):
        store = OfficialStore(actions=[{"id": "x1", "action": "read"}, {"id": "x2", "action": "react"}, {"id": "x3", "action": "archive"}])
        official(store).apply_actions()
        self.assertEqual([f[0] for f in store.finished], ["x1", "x2", "x3"])
        self.assertEqual([f[1] is not None for f in store.finished], [False, True, False])


class Tokens(unittest.TestCase):
    DAY = 24 * 3600

    def test_a_fresh_token_is_left_alone(self):
        store, graph = OfficialStore(), FakeGraph()
        sync = official(store, wall=lambda: 1_000_000.0)
        sync.expires_at = 1_000_000.0 + 59 * self.DAY
        sync.refresh_token(graph)
        self.assertEqual(graph.calls, [])

    def test_a_token_with_under_20_days_left_is_swapped_and_saved(self):
        store, graph = OfficialStore(), FakeGraph(refresh={"access_token": "T1", "token_type": "bearer", "expires_in": 5_183_944})
        sync = official(store, wall=lambda: 1_000_000.0)
        sync.expires_at = 1_000_000.0 + REFRESH_BELOW_S - 10
        sync.refresh_token(graph)
        self.assertEqual((graph.token, store.tokens), ("T1", [("T1", 1_000_000 + 5_183_944)]))
        self.assertEqual(sync.expires_at, 1_000_000.0 + 5_183_944)

    def test_it_asks_only_every_few_hours(self):
        graph = FakeGraph(refresh=GraphError(400, 100, None, "other"))
        sync = official(OfficialStore(), wall=lambda: 1_000_000.0)
        sync.expires_at = 1_000_000.0 + 5 * self.DAY
        sync.refresh_token(graph)
        sync.refresh_token(graph)
        self.assertEqual(len(graph.calls), 1)

    def test_a_token_about_to_end_that_cannot_renew_says_so(self):
        store, graph = OfficialStore(), FakeGraph(refresh=GraphError(400, 100, None, "other"))
        sync = official(store, wall=lambda: 1_000_000.0)
        sync.expires_at = 1_000_000.0 + 2 * self.DAY
        sync.refresh_token(graph)
        self.assertEqual(store.tokens, [])
        self.assertEqual(len(store.details), 1)
        self.assertIn("Connect again", store.details[0])

    def test_a_dead_token_stops_the_account(self):
        graph = FakeGraph(refresh=GraphError(400, 190, None, "login"))
        sync = official(OfficialStore(), wall=lambda: 1_000_000.0)
        sync.expires_at = 1_000_000.0 + self.DAY
        with self.assertRaises(GraphError):
            sync.refresh_token(graph)


class Connecting(unittest.TestCase):
    def connect(self, creds, refreshed=None, wall=1_000_000.0):
        store = OfficialStore()
        store.credentials = lambda account_id: (creds, refreshed)
        sync = OfficialSync(store, {"id": "a1", "user_id": "u1"}, Settings(proxy=None, initial_sync_days=30), threading.Event(), make_graph=lambda token: ("graph", token), wall=lambda: wall)
        return sync, store, sync.connect()

    GOOD = {"kind": "official", "accessToken": "T0", "userId": ME, "username": "mybusiness", "expiresAt": 1_000_000 + 50 * 86400}

    def test_the_saved_token_is_used(self):
        sync, store, graph = self.connect(self.GOOD)
        self.assertEqual(graph, ("graph", "T0"))
        self.assertEqual((sync.viewer, store.statuses), (ME, []))

    def test_a_refreshed_token_wins_over_the_saved_one(self):
        sync, _, graph = self.connect(self.GOOD, {"kind": "official", "accessToken": "T9", "expiresAt": 1_000_000 + 60 * 86400})
        self.assertEqual(graph, ("graph", "T9"))
        self.assertEqual(sync.expires_at, 1_000_000 + 60 * 86400)

    def test_a_private_session_in_refreshed_is_not_a_token(self):
        _, _, graph = self.connect(self.GOOD, {"username": "ana", "settings": {}})
        self.assertEqual(graph, ("graph", "T0"))

    def test_missing_or_expired_credentials_stop_with_a_reason(self):
        for creds, wall in ((None, 1_000_000.0), ({"kind": "official", "userId": ME}, 1_000_000.0), (self.GOOD, 1_000_000.0 + 51 * 86400)):
            _, store, graph = self.connect(creds, wall=wall)
            self.assertIsNone(graph)
            self.assertEqual(store.statuses[0][0], "error")


class Dispatch(unittest.TestCase):
    def test_each_kind_gets_its_own_sync(self):
        started = []

        class Recorder:
            def __init__(self, name):
                self.name = name

            def __call__(self, store, account, settings, stop, on_credentials):
                started.append(self.name)
                self.run = lambda: None
                return self

        class Creds:
            def __init__(self, creds):
                self.creds = creds

            def credentials(self, account_id):
                return self.creds, None

        original = run.OfficialSync, run.AccountSync
        run.OfficialSync, run.AccountSync = Recorder("official"), Recorder("private")
        try:
            for creds in ({"kind": "official", "accessToken": "t"}, {"kind": "private", "username": "a"}, {"username": "a"}, None):
                accounts = run.Accounts(Creds(creds), Settings(proxy=None, initial_sync_days=30))
                accounts.start({"id": "a1", "user_id": "u1"}, "t")
                accounts.halt_all()
        finally:
            run.OfficialSync, run.AccountSync = original
        self.assertEqual(started, ["official", "private", "private", "private"])


if __name__ == "__main__":
    unittest.main()
