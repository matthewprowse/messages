"""The Instagram connector on hand-written private API responses: no instagrapi, network or database.

The responses follow what direct_v2/inbox/ and direct_v2/threads/<id>/ return (instagrapi 3.2.1's
extractors read the same keys). Errors are stand-ins named and nested like instagrapi's exceptions."""

import base64
import os
import stat
import threading
import unittest

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from ai.connectors.instagram import backoff, mapping, outgoing, signin, sync as sync_module
from ai.connectors.instagram.sealing import open_json, seal_json, wrap_local
from ai.connectors.instagram.sync import (
    BAD_USERNAME, LOOKUP_FAILED, MAY_HAVE_SENT, NO_SUCH_USER, OWN_USERNAME, PARTIAL, TEXT_ONLY, AccountSync, Settings, username_of,
)
from ai.fields import BODY, PREVIEW, QUOTE
from ai.keys import unwrap_local

ME = "100"
ANA = {"pk": 200, "username": "ana.m", "full_name": "Ana Mokoena"}
BEN = {"pk": 300, "username": "ben_k", "full_name": ""}
T0 = 1_761_000_000_000_000  # microseconds, as Instagram sends them


# instagrapi's exception classes, by name and nesting (instagrapi/exceptions.py).
class ClientError(Exception):
    pass


class PrivateError(ClientError):
    pass


class ChallengeError(PrivateError):
    pass


class ChallengeRequired(ChallengeError):
    pass


class TwoFactorRequired(PrivateError):
    pass


class BadPassword(PrivateError):
    pass


class LoginRequired(PrivateError):
    pass


class FeedbackRequired(PrivateError):
    pass


class PleaseWaitFewMinutes(PrivateError):
    pass


class ClientThrottledError(ClientError):
    pass


class AccountSuspended(ClientError):
    pass


class ClientConnectionError(ClientError):
    pass


class ProxyAddressIsBlocked(PrivateError):
    pass


class UnknownError(PrivateError):
    pass


class ValidationError(AssertionError):  # pydantic failing on a reply Instagram took
    pass


def item(kind, n=0, user=ANA["pk"], **extra):
    return {"item_id": f"item{n}", "user_id": user, "timestamp": str(T0 + n * 1_000_000), "item_type": kind, **extra}


def raw_thread(items, users=(ANA,), **extra):
    return {
        "thread_id": "340282366841710300949128",
        "thread_v2_id": "17898572618026348",
        "users": [dict(u) for u in users],
        "items": items,
        "thread_title": "",
        "is_group": len(users) > 1,
        "last_activity_at": T0,
        "read_state": 0,
        **extra,
    }


class FakeSealer:
    """Readable stand-ins for sealing and indexes, so payloads can be checked by eye."""

    def seal(self, field, value):
        return None if value is None else f"[{field}]{value}"

    def address(self, value):
        return None if value is None else f"A({value})"

    def address_index(self, value):
        return f"i:{value}"

    def chat_index(self, value):
        return f"c:{value}"


class Items(unittest.TestCase):
    def test_text_link_and_like(self):
        self.assertEqual(mapping.describe(item("text", text="Hi, is the flat still available?")).text, "Hi, is the flat still available?")
        link = mapping.describe(item("link", link={"text": "See https://example.co.za/listing", "link_context": {"link_url": "https://example.co.za/listing"}}))
        self.assertEqual(link.text, "See https://example.co.za/listing")
        self.assertEqual(link.preview, "See https://example.co.za/listing")
        like = mapping.describe(item("like", like="❤️"))
        self.assertEqual((like.text, like.preview), ("❤️", "❤️"))

    def test_photo_takes_the_largest_version(self):
        d = mapping.describe(item("media", media={"media_type": 1, "image_versions2": {"candidates": [
            {"url": "https://cdn/small.jpg", "width": 150, "height": 150},
            {"url": "https://cdn/large.jpg", "width": 1080, "height": 1350},
        ]}}))
        self.assertEqual(d.preview, "Photo")
        self.assertEqual(d.media, mapping.Media("https://cdn/large.jpg", "Photo.jpg", "image/jpeg", "image"))

    def test_video(self):
        d = mapping.describe(item("media", media={"media_type": 2, "video_versions": [
            {"url": "https://cdn/v360.mp4", "width": 360, "height": 640},
            {"url": "https://cdn/v720.mp4", "width": 720, "height": 1280},
        ], "image_versions2": {"candidates": [{"url": "https://cdn/cover.jpg", "width": 720, "height": 1280}]}}))
        self.assertEqual(d.preview, "Video")
        self.assertEqual((d.media.url, d.media.kind, d.media.mime_type), ("https://cdn/v720.mp4", "video", "video/mp4"))

    def test_voice_note_is_named_for_transcription(self):
        d = mapping.describe(item("voice_media", voice_media={"media": {"audio": {"audio_src": "https://cdn/voice.m4a", "duration": 12500}}}))
        self.assertEqual(d.preview, "Voice Note (0:12)")
        self.assertEqual(d.media.filename, "Voice Note.m4a")  # transcribe.py looks for "Voice Note.*"
        self.assertEqual(d.media.kind, "audio")

    def test_disappearing_media_is_never_saved(self):
        d = mapping.describe(item("raven_media", visual_media={"media": {"media_type": 2}, "view_mode": "once"}))
        self.assertIsNone(d.media)
        self.assertEqual(d.preview, "Disappearing Video")
        self.assertIn("Open Instagram", d.text)

    def test_gif_and_sticker(self):
        gif = mapping.describe(item("animated_media", animated_media={"images": {"fixed_height": {"url": "https://media.giphy.com/a/200.gif?cid=1"}}}))
        self.assertEqual((gif.preview, gif.media.filename, gif.media.mime_type), ("GIF", "GIF.gif", "image/gif"))
        sticker = mapping.describe(item("animated_media", animated_media={"is_sticker": True, "images": {"fixed_height": {"url": "https://cdn/s.webp"}}}))
        self.assertEqual((sticker.preview, sticker.media.filename), ("Sticker", "Sticker.webp"))

    def test_shared_posts_and_reels_are_links(self):
        post = mapping.describe(item("media_share", media_share={"code": "CxYz123", "media_type": 1}))
        self.assertEqual((post.preview, post.text), ("Shared Post", "https://www.instagram.com/p/CxYz123/"))
        reel = mapping.describe(item("media_share", media_share={"code": "DaBc456", "product_type": "clips"}))
        self.assertEqual((reel.preview, reel.text), ("Shared Reel", "https://www.instagram.com/reel/DaBc456/"))
        clip = mapping.describe(item("clip", clip={"clip": {"code": "DdEe789"}}))
        self.assertEqual((clip.preview, clip.text), ("Shared Reel", "https://www.instagram.com/reel/DdEe789/"))
        xma = mapping.describe(item("xma_clip", xma_clip=[{"target_url": "https://www.instagram.com/reel/DfGh/", "title_text": "Show day"}]))
        self.assertEqual((xma.preview, xma.text), ("Shared Reel", "Show day\nhttps://www.instagram.com/reel/DfGh/"))
        bare = mapping.describe(item("xma_media_share", xma_media_share=[{}]))
        self.assertTrue(bare.unsupported)

    def test_stories_and_story_replies(self):
        story = mapping.describe(item("story_share", story_share={"media": {"pk": "3172_200", "user": {"username": "ana.m"}}, "text": "Look"}))
        self.assertEqual(story.text, "Look\nhttps://www.instagram.com/stories/ana.m/3172/")
        gone = mapping.describe(item("story_share", story_share={"message": "This story is unavailable"}))
        self.assertEqual(gone.text, "This story is unavailable")
        reply = mapping.describe(item("reel_share", reel_share={"type": "reply", "text": "Love this place"}))
        self.assertEqual(reply.text, "Love this place")
        self.assertEqual(reply.preview, "Replied to Your Story: Love this place")

    def test_profile_location_and_placeholders(self):
        self.assertEqual(mapping.describe(item("profile", profile={"username": "konva"})).text, "https://www.instagram.com/konva/")
        self.assertEqual(mapping.describe(item("location", location={"name": "Cape Town"})).text, "Cape Town")
        placeholder = mapping.describe(item("placeholder", placeholder={"message": "This message is no longer available"}))
        self.assertTrue(placeholder.unsupported)
        unknown = mapping.describe(item("something_new"))
        self.assertEqual(unknown.text, mapping.UNSUPPORTED)
        self.assertTrue(unknown.unsupported)

    def test_notices_and_items_without_an_id_are_skipped(self):
        self.assertIsNone(mapping.describe(item("action_log", action_log={"description": "Ana named the group"})))
        self.assertIsNone(mapping.describe(item("video_call_event")))
        self.assertIsNone(mapping.describe({"item_type": "text", "text": "no id"}))

    def test_replies_quote_and_reactions(self):
        d = mapping.describe(item(
            "text", text="Yes, Saturday works", user=ME,
            replied_to_message={"item_id": "item0", "user_id": 200, "item_type": "text", "text": "Can we view it on Saturday?", "timestamp": str(T0)},
            reactions={"emojis": [{"sender_id": 200, "emoji": "👍", "timestamp": str(T0)}, {"sender_id": None, "emoji": "x"}]},
        ))
        self.assertEqual(d.quoted, mapping.Quoted("item0", "200", "Can we view it on Saturday?"))
        self.assertEqual(d.reactions, (("200", "👍"),))
        self.assertEqual(d.sender_pk, ME)


class Threads(unittest.TestCase):
    def test_thread_leaves_you_out_and_sorts_newest_first(self):
        t = mapping.thread(raw_thread([item("text", 1, text="b"), item("text", 2, text="c"), item("text", 0, text="a")], users=(ANA, {"pk": 100, "username": "me"}), is_group=False), ME)
        self.assertEqual([p.pk for p in t.people], ["200"])
        self.assertFalse(t.is_group)
        self.assertEqual([i.text for i in t.items], ["c", "b", "a"])
        self.assertEqual(t.items[0].sent_at.year, 2025)

    def test_groups_and_names(self):
        t = mapping.thread(raw_thread([], users=(ANA, BEN), thread_title="Viewing Saturday"), ME)
        self.assertTrue(t.is_group)
        self.assertEqual(t.title, "Viewing Saturday")
        self.assertEqual(t.person("300").name, "ben_k")  # no full name: the handle
        self.assertEqual(mapping.Person("1").name, "Instagram Contact")

    def test_unread_by_when_you_last_saw_it(self):
        raw = raw_thread([item("text", 0), item("text", 1, user=ME), item("text", 2), item("text", 3)], last_seen_at={ME: {"item_id": "item2", "timestamp": str(T0 + 2_000_000)}})
        t = mapping.thread(raw, ME)
        unread = {i.id for i in t.items if mapping.is_unread(t, i, ME)}
        self.assertEqual(unread, {"item3"})

    def test_unread_without_a_time_is_the_newest_from_them(self):
        t = mapping.thread(raw_thread([item("text", 0), item("text", 1), item("text", 2, user=ME)], read_state=1), ME)
        self.assertEqual({i.id for i in t.items if mapping.is_unread(t, i, ME)}, {"item1"})

    def test_inbox_cursor_only_when_there_is_more(self):
        page = {"inbox": {"threads": [raw_thread([])], "has_older": True, "oldest_cursor": "cur1"}}
        threads, cursor = mapping.inbox(page, ME)
        self.assertEqual((len(threads), cursor), (1, "cur1"))
        self.assertIsNone(mapping.inbox({"inbox": {"threads": [], "has_older": False, "oldest_cursor": "x"}}, ME)[1])


class Payloads(unittest.TestCase):
    def setUp(self):
        self.s = FakeSealer()

    def test_inbound_message_in_the_whatsapp_shape(self):
        t = mapping.thread(raw_thread([item("media", 0, media={"image_versions2": {"candidates": [{"url": "https://cdn/p.jpg", "width": 1, "height": 1}]}})]), ME)
        p = mapping.payload(self.s, t, t.items[0], ME, live=True, unread=True)
        self.assertEqual(p["provider_message_id"], "item0")
        self.assertEqual((p["chat_jid"], p["chat_index"]), ("A(340282366841710300949128)", "c:340282366841710300949128"))
        self.assertEqual((p["direction"], p["is_read"], p["resurface"], p["status"]), ("inbound", False, True, "inbox"))
        self.assertEqual(p["sender_address"], "A(200)")
        self.assertEqual(p["sender_index"], "i:200")
        self.assertEqual(p["sender"], {"pk": "A(200)", "pk_index": "i:200", "username": "A(ana.m)", "username_index": "i:ana.m", "display_name": "Ana Mokoena", "handle": "ana.m"})
        self.assertEqual(p["participants"], [p["sender"]])
        self.assertEqual(p["preview"], f"[{PREVIEW}]Photo")
        self.assertIsNone(p["body_text"])
        self.assertEqual(p["provider_meta"]["receipt"], "pending")
        self.assertEqual(p["provider_meta"]["chat"], "A(340282366841710300949128)")
        self.assertEqual(p["attachments"], [{"filename": "[filename]Photo.jpg", "mime_type": "image/jpeg", "kind": "image", "size_bytes": None}])

    def test_your_own_message_and_history(self):
        t = mapping.thread(raw_thread([item("text", 0, user=ME, text="On my way")], archived=True), ME)
        p = mapping.payload(self.s, t, t.items[0], ME, live=False, unread=False)
        self.assertEqual((p["direction"], p["is_read"], p["resurface"], p["status"]), ("outbound", True, False, "archived"))
        self.assertIsNone(p["sender"])
        self.assertIsNone(p["sender_address"])
        self.assertEqual(p["body_text"], f"[{BODY}]On my way")
        self.assertNotIn("receipt", p["provider_meta"])

    def test_group_preview_names_the_sender(self):
        t = mapping.thread(raw_thread([item("text", 0, user=BEN["pk"], text="I can do 10am")], users=(ANA, BEN)), ME)
        p = mapping.payload(self.s, t, t.items[0], ME, live=True, unread=True)
        self.assertEqual(p["preview"], f"[{PREVIEW}]ben_k: I can do 10am")
        self.assertEqual(p["participants"], [])  # people join a group thread as they speak, as in WhatsApp
        self.assertEqual(p["group_name"], "Ana Mokoena, ben_k")
        self.assertEqual(p["provider_meta"]["participant"], "A(300)")

    def test_quote_and_reactions_are_sealed(self):
        raw = item("text", 1, user=ME, text="Yes",
                   replied_to_message={"item_id": "item0", "user_id": 200, "item_type": "text", "text": "Saturday?", "timestamp": str(T0)},
                   reactions={"emojis": [{"sender_id": 200, "emoji": "👍"}, {"sender_id": 100, "emoji": "😂"}]})
        t = mapping.thread(raw_thread([raw]), ME)
        meta = mapping.payload(self.s, t, t.items[0], ME, live=True, unread=False)["provider_meta"]
        self.assertEqual(meta["quoted"], {"id": "item0", "from_me": False, "author": "Ana Mokoena", "text": f"[{QUOTE}]Saturday?"})
        self.assertEqual(meta["reactions"], {"i:200": "👍", "me": "😂"})
        self.assertEqual(meta["reactors"], {"i:200": "A(200)"})

    def test_sent_item(self):
        i = mapping.sent_item("item9", ME, "Thanks!")
        self.assertEqual((i.id, i.sender_pk, i.text, i.type), ("item9", ME, "Thanks!", "text"))


class Backoffs(unittest.TestCase):
    def test_kinds_by_instagrapi_class(self):
        cases = {
            AccountSuspended: "banned", ChallengeRequired: "challenge", ChallengeError: "challenge", TwoFactorRequired: "two_factor",
            LoginRequired: "login", BadPassword: "bad_password", FeedbackRequired: "feedback", PleaseWaitFewMinutes: "rate",
            ClientThrottledError: "rate", ClientConnectionError: "network", ProxyAddressIsBlocked: "blocked_ip", UnknownError: "other",
        }
        for cls, kind in cases.items():
            self.assertEqual(backoff.kind_of(cls("x")), kind, cls.__name__)
        self.assertEqual(backoff.kind_of(TimeoutError()), "network")
        self.assertEqual(backoff.kind_of(ValueError()), "other")

        class WithStatus(Exception):
            code = 429

        self.assertEqual(backoff.kind_of(WithStatus()), "rate")

    def test_challenges_sign_outs_and_bans_stop_the_account(self):
        for err in (ChallengeRequired(), LoginRequired(), AccountSuspended(), TwoFactorRequired(), ProxyAddressIsBlocked()):
            t = backoff.trouble(err)
            self.assertTrue(t.stop, type(err).__name__)
            self.assertNotIn("—", t.detail)
        for err in (PleaseWaitFewMinutes(), FeedbackRequired(), ClientConnectionError(), UnknownError()):
            self.assertFalse(backoff.trouble(err).stop)

    def test_rate_limits_back_off_hard_and_double(self):
        b = backoff.Backoff(rand=lambda: 0.5)  # no jitter
        rate = backoff.trouble(PleaseWaitFewMinutes())
        self.assertEqual([b.next(rate) for _ in range(6)], [900, 1800, 3600, 7200, 14400, 14400])
        b.reset()
        self.assertEqual(b.next(backoff.trouble(FeedbackRequired())), 6 * 3600)
        self.assertEqual(b.next(backoff.trouble(FeedbackRequired())), 12 * 3600)
        b.reset()
        self.assertEqual(b.next(backoff.trouble(ClientConnectionError())), 60)

    def test_jitter_stays_within_a_quarter(self):
        rate = backoff.trouble(PleaseWaitFewMinutes())
        self.assertEqual(backoff.Backoff(rand=lambda: 0.0).next(rate), 900 * 0.75)
        self.assertEqual(backoff.Backoff(rand=lambda: 1.0).next(rate), 900 * 1.25)

    def test_polls_slow_down_when_quiet(self):
        mid = lambda: 0.5
        self.assertEqual(backoff.poll_wait(0, mid), 180)
        self.assertEqual(backoff.poll_wait(45 * 60, mid), 360)
        self.assertEqual(backoff.poll_wait(5 * 3600, mid), 720)
        self.assertGreaterEqual(min(backoff.poll_wait(0, lambda: r) for r in (0.0, 1.0)), 135)


class FakeCodes:
    def __init__(self, codes=()):
        self.codes = list(codes)
        self.asked = []
        self.finished = False

    def ask(self, step, method, attempt):
        self.asked.append((step, method, attempt))

    def take(self):
        return self.codes.pop(0) if self.codes else None

    def done(self):
        self.finished = True


class ChallengeChoice:
    def __init__(self, name):
        self.name = name


class FakeClient:
    """Logs in the way instagrapi does: a challenge calls challenge_code_handler, two-factor raises."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = []
        self.last_json = {}
        self.with_challenge_flow = False

    def login(self, username, password, verification_code=""):
        self.calls.append(verification_code)
        step = self.script.pop(0)
        if callable(step):
            return step(self)
        if isinstance(step, Exception):
            raise step
        return True


class SignIns(unittest.TestCase):
    def run_sign_in(self, client, codes, stop=None):
        clock = iter(range(0, 10_000, 1))
        signin.sign_in(client, "ana.m", "secret", codes, stop or threading.Event(), poll_s=0, wait_s=5, now=lambda: next(clock))

    def test_plain_sign_in(self):
        client, codes = FakeClient([True]), FakeCodes()
        self.run_sign_in(client, codes)
        self.assertEqual(codes.asked, [])
        self.assertTrue(codes.finished)
        self.assertFalse(client.with_challenge_flow)

    def test_challenge_code_by_email(self):
        def challenge(c):
            self.assertTrue(c.with_challenge_flow)
            code = c.challenge_code_handler("ana.m", ChallengeChoice("EMAIL"))
            if code != "123456":
                raise ChallengeRequired()
            return True

        client, codes = FakeClient([challenge]), FakeCodes([None, None, "123 456"])
        self.run_sign_in(client, codes)
        self.assertEqual(codes.asked, [("code", "email", 1)])

    def test_challenge_code_by_sms_asked_again_when_wrong(self):
        def challenge(c):
            first = c.challenge_code_handler("ana.m", ChallengeChoice("SMS"))
            second = c.challenge_code_handler("ana.m", ChallengeChoice("SMS"))
            self.assertEqual((first, second), ("111111", "222222"))
            return True

        codes = FakeCodes(["111111", "222222"])
        self.run_sign_in(FakeClient([challenge]), codes)
        self.assertEqual(codes.asked, [("code", "sms", 1), ("code", "sms", 2)])

    def test_two_factor(self):
        def needs_code(c):
            c.last_json = {"two_factor_info": {"totp_two_factor_on": True, "sms_two_factor_on": False}}
            raise TwoFactorRequired()

        client, codes = FakeClient([needs_code, UnknownError("invalid code"), True]), FakeCodes(["000000", "654321"])
        self.run_sign_in(client, codes)
        self.assertEqual(client.calls, ["", "000000", "654321"])
        self.assertEqual(codes.asked, [("two_factor", "app", 1), ("two_factor", "app", 2)])

    def test_two_factor_wrong_three_times(self):
        client = FakeClient([TwoFactorRequired(), TwoFactorRequired(), TwoFactorRequired(), TwoFactorRequired()])
        with self.assertRaises(signin.SignInFailed) as failed:
            self.run_sign_in(client, FakeCodes(["1", "2", "3"]))
        self.assertEqual(failed.exception.code, "wrong_code")

    def test_code_not_entered_in_time(self):
        def challenge(c):
            if not c.challenge_code_handler("ana.m", ChallengeChoice("EMAIL")):
                raise ChallengeRequired()  # what instagrapi does with an empty code

        codes = FakeCodes()
        with self.assertRaises(signin.SignInFailed) as failed:
            self.run_sign_in(FakeClient([challenge]), codes)
        self.assertEqual(failed.exception.code, "timeout")
        self.assertTrue(codes.finished)

    def test_failures_have_plain_reasons(self):
        for err, code in ((BadPassword(), "bad_password"), (ChallengeRequired(), "challenge"), (PleaseWaitFewMinutes(), "rate"),
                          (AccountSuspended(), "banned"), (ClientConnectionError(), "network"), (ValueError(), "other")):
            with self.assertRaises(signin.SignInFailed) as failed:
                self.run_sign_in(FakeClient([err]), FakeCodes())
            self.assertEqual(failed.exception.code, code)
            self.assertNotIn("—", failed.exception.detail)

    def test_stopping_while_waiting(self):
        stop = threading.Event()
        stop.set()

        def challenge(c):
            return c.challenge_code_handler("ana.m", ChallengeChoice("EMAIL"))

        with self.assertRaises(signin.SignInStopped):
            self.run_sign_in(FakeClient([challenge]), FakeCodes(), stop)

    def test_two_factor_method(self):
        self.assertEqual(signin.two_factor_method({"two_factor_info": {"sms_two_factor_on": True, "totp_two_factor_on": False}}), "sms")
        self.assertEqual(signin.two_factor_method({"a": [{"totp_two_factor_on": 1}]}), "app")
        self.assertIsNone(signin.two_factor_method(None))


class Sealing(unittest.TestCase):
    def test_json_matches_the_workers_v1_format(self):
        key = base64.b64encode(os.urandom(32)).decode()
        sealed = seal_json({"username": "ana.m", "password": "x"}, key)
        raw = base64.b64decode(sealed[3:])
        # apps/worker/src/crypto.ts: iv 12 | tag 16 | ciphertext
        plain = AESGCM(base64.b64decode(key)).decrypt(raw[:12], raw[28:] + raw[12:28], None)
        self.assertEqual(plain, b'{"username": "ana.m", "password": "x"}')
        self.assertEqual(open_json(sealed, key), {"username": "ana.m", "password": "x"})

    def test_new_user_keys_unwrap_like_the_workers(self):
        master = base64.b64encode(os.urandom(32)).decode()
        data_key = os.urandom(32)
        self.assertEqual(unwrap_local(master, wrap_local(master, data_key, "user-1"), "user-1"), data_key)


class FakeStore:
    def __init__(self, outbox=(), actions=(), receipts=(), new_chats=()):
        self.outbox = list(outbox)
        self.new_chats = list(new_chats)
        self.linked = []
        self.actions = list(actions)
        self.receipts = list(receipts)
        self.claimed, self.failed, self.settled, self.ingested, self.finished, self.receipt_states = [], [], [], [], [], []
        self.statuses, self.marked, self.newest, self.scoped = [], [], None, {}
        self.files = {}  # outbox id -> file rows; their bytes by storage path in self.blobs
        self.blobs = {}
        self.contacts, self.photos = {}, []  # pk -> contact row; (contact id, bytes) saved

    def queued_outbox(self, account_id):
        rows, self.outbox = self.outbox, []
        return rows

    def queued_new_chats(self, account_id):
        rows, self.new_chats = self.new_chats, []
        return rows

    def count_outbox_files(self, outbox_id):
        return len(self.files.get(outbox_id, []))

    def outbox_files(self, outbox_id, limit):
        return self.files.get(outbox_id, [])[:limit]

    def download_outbox_file(self, path):
        return self.blobs.get(path)

    def contact_to_photograph(self, user_id, sealer, pk):
        return self.contacts.get(pk)

    def save_contact_photo(self, user_id, contact, data):
        self.photos.append((contact["id"], data))
        return True

    def link_thread(self, outbox_id, thread_id):
        self.linked.append((outbox_id, thread_id))

    def claim(self, outbox_id):
        self.claimed.append(outbox_id)
        return True

    def fail(self, outbox_id, reason):
        self.failed.append((outbox_id, reason))

    def settle(self, outbox_id, provider_id):
        self.settled.append((outbox_id, provider_id))
        return True

    def body(self, user_id, value):
        return value or ""

    def address(self, user_id, value):
        return value or ""

    def sealer(self, user_id):
        return FakeSealer()

    def ingest(self, account_id, payloads):
        self.ingested.extend(payloads)
        return [{"result": "inserted", "message_id": f"m{i}", "thread_id": "thread-uuid", "attachment_ids": []} for i, _ in enumerate(payloads)]

    def queued_actions(self, account_id):
        rows, self.actions = self.actions, []
        return rows

    def finish_action(self, action_id, error=None):
        self.finished.append((action_id, error))

    def pending_receipts(self, account_id, thread_id):
        return self.receipts

    def set_receipts(self, account_id, ids, state):
        self.receipt_states.append((ids, state))

    def newest_seen(self, account_id, scope=None):
        return self.newest if scope is None else self.scoped.get(scope)

    def save_newest(self, account_id, ts, scope=None):
        if scope is None:
            self.newest = ts
        else:
            self.scoped[scope] = ts

    def mark_read_on_phone(self, account_id, sealer, thread_ids):
        self.marked.append(list(thread_ids))
        return 0

    def save_file(self, *args):
        raise AssertionError("no files in these tests")

    def set_status(self, account, status, detail=None):
        self.statuses.append((status, detail))

    def emit(self, *args, **kwargs):
        pass


class SendClient:
    def __init__(self, result=None, error=None, payload_id=None):
        self.result, self.error, self.payload_id = result, error, payload_id
        self.sent, self.seen = [], []
        self.last_json = {"payload": {"item_id": "stale"}}

    def direct_send(self, text, thread_ids):
        self.sent.append((text, thread_ids))
        if self.payload_id:
            self.last_json = {"payload": {"item_id": self.payload_id}}
        if self.error:
            raise self.error
        return self.result

    def direct_message_seen(self, thread_id, message_id):
        self.seen.append((thread_id, message_id))
        return True

    def generate_uuid(self):
        return "uuid"


class Item_:
    def __init__(self, item_id):
        self.id = item_id


def outbox_row(**extra):
    return {
        "id": "o1", "user_id": "u1", "body": "See you at 10", "attachment_count": 0, "thread_id": "t1",
        "threads": {"account_id": "a1", "channel": "instagram", "user_id": "u1", "provider_thread_id": "340282366841710300949128", "is_group": False, "group_name": None},
        **extra,
    }


def account_sync(store):
    sync = AccountSync(store, {"id": "a1", "user_id": "u1"}, Settings(proxy=None, initial_sync_days=30), threading.Event(), rand=lambda: 0.5)
    sync.viewer = ME
    return sync


class Sending(unittest.TestCase):
    def test_reply_goes_to_its_thread_and_is_stored(self):
        store, client = FakeStore([outbox_row()]), SendClient(result=Item_("item77"))
        account_sync(store).send_outbox(client)
        self.assertEqual(client.sent, [("See you at 10", [340282366841710300949128])])
        self.assertEqual(store.settled, [("o1", "item77")])
        self.assertEqual(store.ingested[0]["provider_message_id"], "item77")
        self.assertEqual(store.ingested[0]["direction"], "outbound")

    def test_other_accounts_are_not_sent(self):
        client = SendClient(result=Item_("x"))
        other = outbox_row()
        other["threads"] = {**other["threads"], "account_id": "a2"}
        store = FakeStore([other])
        account_sync(store).send_outbox(client)
        self.assertEqual(store.claimed, [])
        self.assertEqual(client.sent, [])

    def test_a_failed_send_is_never_retried(self):
        store, client = FakeStore([outbox_row()]), SendClient(error=FeedbackRequired())
        with self.assertRaises(FeedbackRequired):
            account_sync(store).send_outbox(client)
        self.assertEqual(store.failed, [("o1", MAY_HAVE_SENT)])
        self.assertEqual(store.settled, [])

    def test_a_reply_instagram_took_counts_as_sent(self):
        # instagrapi's model failed on the response, after Instagram took the message.
        store, client = FakeStore([outbox_row()]), SendClient(error=ValidationError(), payload_id="item88")
        account_sync(store).send_outbox(client)
        self.assertEqual(store.settled, [("o1", "item88")])
        self.assertEqual(store.failed, [])

    def test_a_stale_id_is_never_used(self):
        store, client = FakeStore([outbox_row()]), SendClient(error=ValidationError())
        with self.assertRaises(ValidationError):
            account_sync(store).send_outbox(client)
        self.assertEqual(store.failed, [("o1", MAY_HAVE_SENT)])


UID = "0b8f0c1e-1111-4222-8333-444455556666"
PATH_ONE = f"{UID}/outbox/9f1c2a3b-0000-4000-8000-000000000001/photo.jpg"
PATH_TWO = f"{UID}/outbox/9f1c2a3b-0000-4000-8000-000000000002/clip.mp4"
JPEG = b"\xff\xd8\xff\xe0" + b"jpeg" * 8
PNG = b"\x89PNG\r\n\x1a\n" + b"png" * 8
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"video" * 8


class FileClient(SendClient):
    """Records text, photos and videos in the order they go, reading each file as it is sent."""

    def __init__(self, fail_at=None, error=None, **kw):
        super().__init__(result=Item_("text1"), **kw)
        self.calls, self.fail_at, self.fail_error, self.paths = [], fail_at, error, []

    def send_item(self, kind, what, thread_ids):
        if self.fail_at == len(self.calls):
            self.last_json = {}
            raise self.fail_error
        self.calls.append((kind, what, thread_ids))
        return Item_(f"{kind}{len(self.calls)}")

    def direct_send(self, text, thread_ids):
        return self.send_item("text", text, thread_ids)

    def direct_send_photo(self, path, thread_ids):
        self.paths.append((path, stat.S_IMODE(os.stat(path).st_mode)))
        with open(path, "rb") as f:
            return self.send_item("photo", (os.path.splitext(path)[1], f.read()), thread_ids)

    def direct_send_video(self, path, thread_ids):
        self.paths.append((path, stat.S_IMODE(os.stat(path).st_mode)))
        with open(path, "rb") as f:
            return self.send_item("video", (os.path.splitext(path)[1], f.read()), thread_ids)


def file_row(path, mime, size=10, user=UID, n=0):
    return {"id": f"f{n}", "user_id": user, "storage_path": path, "filename": "x", "mime_type": mime, "size_bytes": size, "position": n}


def with_files(files, blobs, **extra):
    row = outbox_row(user_id=UID, attachment_count=len(files), **extra)
    row["threads"] = {**row["threads"], "user_id": UID}
    store = FakeStore([row])
    store.files["o1"] = files
    store.blobs = blobs
    return store


class Attachments(unittest.TestCase):
    def setUp(self):
        self.pause = sync_module.FILE_PAUSE_S
        sync_module.FILE_PAUSE_S = (0.0, 0.0)

    def tearDown(self):
        sync_module.FILE_PAUSE_S = self.pause

    def run_row(self, store, client):
        sync = account_sync(store)
        sync.user_id = UID
        sync.send_outbox(client)

    def test_text_then_photo_then_video_in_order(self):
        store = with_files([file_row(PATH_ONE, "image/jpeg", n=0), file_row(PATH_TWO, "video/mp4", n=1)], {PATH_ONE: JPEG, PATH_TWO: MP4})
        client = FileClient()
        self.run_row(store, client)
        tid = [340282366841710300949128]
        self.assertEqual(client.calls, [("text", "See you at 10", tid), ("photo", (".jpg", JPEG), tid), ("video", (".mp4", MP4), tid)])
        self.assertEqual(store.settled, [("o1", "text1")])
        self.assertEqual(store.failed, [])
        self.assertEqual(store.ingested[0]["provider_message_id"], "text1")  # the text is stored at once; the poll finds the files
        self.assertTrue(all(mode == 0o600 for _, mode in client.paths))
        self.assertFalse(any(os.path.exists(p) for p, _ in client.paths))  # temp files are gone

    def test_a_photo_alone_goes_by_its_bytes_not_its_name(self):
        store = with_files([file_row(PATH_ONE, "image/png")], {PATH_ONE: PNG}, body="")
        client = FileClient()
        self.run_row(store, client)
        self.assertEqual([c[:2] for c in client.calls], [("photo", (".png", PNG))])
        self.assertEqual(store.settled, [("o1", "photo1")])

    def test_documents_are_turned_down_plainly_before_anything_is_sent(self):
        for mime, blobs in [("application/pdf", {PATH_ONE: b"%PDF-1.7"}), ("image/jpeg", {PATH_ONE: b"%PDF-1.7"}), ("image/gif", {PATH_ONE: b"GIF89a....."})]:
            store, client = with_files([file_row(PATH_ONE, mime)], blobs), FileClient()
            self.run_row(store, client)
            self.assertEqual(store.failed, [("o1", outgoing.ONLY_MEDIA)], mime)
            self.assertEqual(client.calls, [])
        self.assertNotIn("\u2014", outgoing.ONLY_MEDIA)
        self.assertEqual(outgoing.ONLY_MEDIA, "Instagram can only take photos and videos. Send other files another way.")

    def test_a_count_mismatch_fails_the_row(self):
        store = with_files([file_row(PATH_ONE, "image/jpeg")], {PATH_ONE: JPEG})
        store.outbox[0]["attachment_count"] = 2
        sync = account_sync(store)
        sync.user_id = UID
        waits = []
        sync.stop.wait = lambda s: waits.append(s) or False
        ticks = iter(range(0, 1000, 20))
        real = outgoing.time.monotonic
        outgoing.time.monotonic = lambda: next(ticks)
        try:
            sync.send_outbox(FileClient())
        finally:
            outgoing.time.monotonic = real
        self.assertEqual(store.failed, [("o1", outgoing.NOT_UPLOADED)])
        too_many = with_files([file_row(PATH_ONE, "image/jpeg"), file_row(PATH_TWO, "video/mp4", n=1)], {})
        too_many.outbox[0]["attachment_count"] = 1
        self.run_row(too_many, FileClient())
        self.assertEqual(too_many.failed, [("o1", outgoing.CHANGED)])

    def test_rows_that_arrive_late_are_waited_for(self):
        store = with_files([file_row(PATH_ONE, "image/jpeg")], {PATH_ONE: JPEG})
        store.outbox[0]["attachment_count"] = 2
        sync = account_sync(store)
        sync.user_id = UID

        def arrive(_seconds):
            store.files["o1"].append(file_row(PATH_TWO, "video/mp4", n=1))
            store.blobs[PATH_TWO] = MP4
            return False

        sync.stop.wait = arrive
        client = FileClient()
        sync.send_outbox(client)
        self.assertEqual([c[0] for c in client.calls], ["text", "photo", "video"])

    def test_a_path_that_is_not_the_users_own_is_refused(self):
        for path in [
            "11111111-2222-4333-8444-555555555555/outbox/9f1c2a3b-0000-4000-8000-000000000001/photo.jpg",  # someone else's folder
            f"{UID}/outbox/9f1c2a3b-0000-4000-8000-000000000001/../x.jpg",
            f"{UID}/{UID}/other.jpg",
            f"{UID}/outbox/9f1c2a3b-0000-4000-8000-000000000001/sub/photo.jpg",
        ]:
            store, client = with_files([file_row(path, "image/jpeg")], {path: JPEG}), FileClient()
            self.run_row(store, client)
            self.assertEqual(store.failed, [("o1", outgoing.MISSING)], path)
            self.assertEqual(client.calls, [])
        store, client = with_files([file_row(PATH_ONE, "image/jpeg", user="11111111-2222-4333-8444-555555555555")], {PATH_ONE: JPEG}), FileClient()
        self.run_row(store, client)
        self.assertEqual(store.failed, [("o1", outgoing.MISSING)])

    def test_big_files_are_refused(self):
        store, client = with_files([file_row(PATH_ONE, "image/jpeg", size=outgoing.MAX_FILE_BYTES + 1)], {PATH_ONE: JPEG}), FileClient()
        self.run_row(store, client)
        self.assertEqual(store.failed, [("o1", outgoing.TOO_LARGE)])
        self.assertEqual(client.calls, [])

    def test_a_file_that_fails_after_the_text_says_so_and_nothing_is_resent(self):
        store = with_files([file_row(PATH_ONE, "image/jpeg", n=0), file_row(PATH_TWO, "video/mp4", n=1)], {PATH_ONE: JPEG, PATH_TWO: MP4})
        client = FileClient(fail_at=1, error=FeedbackRequired())
        with self.assertRaises(FeedbackRequired):
            self.run_row(store, client)
        self.assertEqual([c[0] for c in client.calls], ["text"])  # the photo failed, so the video was not tried
        self.assertEqual(store.failed, [("o1", PARTIAL.format(done=1, total=3))])
        self.assertEqual(store.settled, [])
        self.assertEqual(len(store.ingested), 1)  # the text that went is stored

    def test_a_first_item_that_fails_is_maybe_sent(self):
        store = with_files([file_row(PATH_ONE, "image/jpeg")], {PATH_ONE: JPEG}, body="")
        client = FileClient(fail_at=0, error=ValidationError())
        with self.assertRaises(ValidationError):
            self.run_row(store, client)
        self.assertEqual(store.failed, [("o1", MAY_HAVE_SENT)])

    def test_a_file_instagram_took_counts_as_sent(self):
        store = with_files([file_row(PATH_ONE, "image/jpeg")], {PATH_ONE: JPEG}, body="")
        client = FileClient(fail_at=0, error=ValidationError(), payload_id="item99")
        # the fake clears last_json when it fails, so put the raw reply back as instagrapi would have it
        original = client.send_item

        def failing(kind, what, thread_ids):
            client.last_json = {"payload": {"item_id": "item99"}}
            raise ValidationError()

        client.send_item = failing
        self.run_row(store, client)
        self.assertEqual(store.settled, [("o1", "item99")])
        self.assertEqual(store.failed, [])

    def test_a_missing_upload_fails_without_sending(self):
        store, client = with_files([file_row(PATH_ONE, "image/jpeg")], {}), FileClient()
        self.run_row(store, client)
        self.assertEqual(store.failed, [("o1", outgoing.MISSING)])
        self.assertEqual(client.calls, [])


class Avatars(unittest.TestCase):
    def thread_with(self, **user):
        return raw_thread([item("text", 5, text="Hello")], users=({**ANA, **user},))

    def poll(self, store, raw):
        client = PollClient([{"inbox": {"threads": [raw], "has_older": False}}])
        sync = account_sync(store)
        fetched = []
        real = sync_module.fetch
        sync_module.fetch = lambda url, proxy, ua, limit=0, timeout=0: fetched.append((url, limit)) or JPEG
        try:
            sync.poll(client)
            sync.poll(PollClient([{"inbox": {"threads": [raw], "has_older": False}}]))  # a second look is skipped
        finally:
            sync_module.fetch = real
        return fetched

    def test_the_picture_is_fetched_once_and_saved_to_the_contact(self):
        store = FakeStore()
        store.contacts["200"] = {"id": "c1", "avatar_path": None, "avatar_source": None, "avatar_updated_at": None}
        fetched = self.poll(store, self.thread_with(profile_pic_url="https://cdn.example/ana.jpg"))
        self.assertEqual(fetched, [("https://cdn.example/ana.jpg", sync_module.AVATAR_MAX_BYTES)])
        self.assertEqual(store.photos, [("c1", JPEG)])

    def test_nothing_is_fetched_when_the_photo_is_not_due_or_missing(self):
        store = FakeStore()  # no contact for them yet
        self.assertEqual(self.poll(store, self.thread_with(profile_pic_url="https://cdn.example/ana.jpg")), [])
        self.assertEqual(self.poll(FakeStore(), self.thread_with()), [])  # no picture URL
        default = self.thread_with(profile_pic_url=f"https://cdn.example/{sync_module.DEFAULT_AVATAR}.jpg")
        self.assertEqual(self.poll(FakeStore(), default), [])

    def test_a_failed_download_never_breaks_the_sync(self):
        store = FakeStore()
        store.contacts["200"] = {"id": "c1"}
        sync = account_sync(store)
        real = sync_module.fetch

        def boom(*a, **k):
            raise OSError("https://secret.example/url")

        sync_module.fetch = boom
        try:
            stored = sync.poll(PollClient([{"inbox": {"threads": [self.thread_with(profile_pic_url="https://cdn.example/a.jpg")], "has_older": False}}]))
        finally:
            sync_module.fetch = real
        self.assertEqual(stored, 1)
        self.assertEqual(store.photos, [])

    def test_the_picture_url_is_mapped(self):
        self.assertEqual(mapping.person({"pk": 1, "username": "a", "profile_pic_url": "https://x/y"}).picture, "https://x/y")
        self.assertIsNone(mapping.person({"pk": 1}).picture)


class PhotoRules(unittest.TestCase):
    NOW = sync_module.datetime(2026, 11, 7, tzinfo=sync_module.timezone.utc)

    def test_when_a_photo_is_due(self):
        from ai.connectors.instagram.store import photo_due, image_type

        self.assertTrue(photo_due({"avatar_path": None}, self.NOW))
        self.assertFalse(photo_due({"avatar_path": "p", "avatar_source": "google"}, self.NOW))
        self.assertFalse(photo_due({"avatar_path": "p", "avatar_source": "whatsapp"}, self.NOW))
        self.assertFalse(photo_due({"avatar_path": "p", "avatar_source": "instagram", "avatar_updated_at": "2026-11-03T00:00:00+00:00"}, self.NOW))
        self.assertTrue(photo_due({"avatar_path": "p", "avatar_source": "instagram", "avatar_updated_at": "2026-10-20T00:00:00+00:00"}, self.NOW))
        self.assertEqual((image_type(JPEG), image_type(PNG), image_type(b"<html>")), ("image/jpeg", "image/png", None))

    def test_store_saves_under_user_and_contact_and_never_over_another_source(self):
        from ai.connectors.instagram.store import Store

        calls = []

        class Db:
            def upload(self, bucket, path, data, content_type):
                calls.append(("upload", bucket, path, content_type))

            def update(self, table, filters, patch, minimal=False):
                calls.append(("update", table, patch["avatar_path"], patch["avatar_source"]))

        store = Store.__new__(Store)
        store.db = Db()
        self.assertTrue(store.save_contact_photo("u1", {"id": "c1"}, JPEG))
        self.assertEqual(calls, [("upload", "avatars", "u1/c1", "image/jpeg"), ("update", "contacts", "u1/c1", "instagram")])
        calls.clear()
        self.assertFalse(store.save_contact_photo("u1", {"id": "c1", "avatar_path": "x", "avatar_source": "icloud"}, JPEG))
        self.assertFalse(store.save_contact_photo("u1", {"id": "c1"}, b"<html>not an image"))
        self.assertFalse(store.save_contact_photo("u1", {"id": "c1"}, JPEG + b"0" * (2 * 1024 * 1024)))
        self.assertEqual(calls, [])


class NewChatClient(SendClient):
    """Looks a username up and sends to a user ID, as instagrapi's user_info_by_username_v1 and direct_send do."""

    def __init__(self, user=None, lookup_error=None, **kw):
        super().__init__(**kw)
        self.user, self.lookup_error, self.looked_up = user, lookup_error, []

    def user_info_by_username_v1(self, username):
        self.looked_up.append(username)
        if self.lookup_error:
            raise self.lookup_error
        return self.user

    def direct_send(self, text, user_ids=(), thread_ids=()):
        self.sent.append((text, list(user_ids), list(thread_ids)))
        if self.payload_id:
            self.last_json = {"payload": {"item_id": self.payload_id, "thread_id": "3402"}}
        if self.error:
            raise self.error
        return self.result


class User:
    def __init__(self, pk, username="ana.m", full_name="Ana Mokoena"):
        self.pk, self.username, self.full_name = pk, username, full_name


class UserNotFound(ClientError):
    pass


class Sent(Item_):
    def __init__(self, item_id, thread_id):
        super().__init__(item_id)
        self.thread_id = thread_id


def new_chat_row(to="@Ana.M", **extra):
    return {"id": "n1", "user_id": "u1", "account_id": "a1", "body": "Hi Ana", "attachment_count": 0, "to_addresses": [to], **extra}


class NewChats(unittest.TestCase):
    def send(self, row, client):
        store = FakeStore(new_chats=[row])
        sync = account_sync(store)
        sync.username = "me.k"
        sync.pause = lambda: None
        return store, sync

    def test_usernames_are_cleaned(self):
        self.assertEqual(username_of(" @Ana.M "), "ana.m")
        self.assertEqual(username_of("https://www.instagram.com/ana.m/?hl=en"), "ana.m")
        self.assertEqual(username_of("ana m"), "ana m")

    def test_a_first_message_looks_the_user_up_sends_stores_and_links(self):
        client = NewChatClient(user=User(200), result=Sent("item5", 3402))
        store, sync = self.send(new_chat_row(), client)
        sync.send_outbox(client)
        self.assertEqual(client.looked_up, ["ana.m"])
        self.assertEqual(client.sent, [("Hi Ana", [200], [])])
        self.assertEqual(store.settled, [("n1", "item5")])
        self.assertEqual(store.ingested[0]["chat_jid"], "A(3402)")
        self.assertEqual(store.ingested[0]["direction"], "outbound")
        self.assertEqual(store.ingested[0]["participants"][0]["handle"], "ana.m")
        self.assertEqual(store.linked, [("n1", "thread-uuid")])

    def test_the_thread_comes_from_the_raw_answer_when_the_model_failed(self):
        client = NewChatClient(user=User(200), error=ValidationError(), payload_id="item6")
        store, sync = self.send(new_chat_row(), client)
        sync.send_outbox(client)
        self.assertEqual(store.settled, [("n1", "item6")])
        self.assertEqual(store.ingested[0]["chat_jid"], "A(3402)")
        self.assertEqual(store.linked, [("n1", "thread-uuid")])

    def test_bad_usernames_files_and_yourself_send_nothing(self):
        for row, reason in [
            (new_chat_row("two words"), BAD_USERNAME),
            (new_chat_row(""), BAD_USERNAME),
            (new_chat_row(to_addresses=["a.b", "c.d"]), BAD_USERNAME),
            (new_chat_row("ME.K"), OWN_USERNAME),
            (new_chat_row(attachment_count=1), TEXT_ONLY),
            (new_chat_row(body=" "), "There is nothing to send."),
        ]:
            client = NewChatClient(user=User(200), result=Sent("x", 1))
            store, sync = self.send(row, client)
            sync.send_outbox(client)
            self.assertEqual(store.failed, [("n1", reason)], row)
            self.assertEqual(client.sent, [])
        client = NewChatClient(user=User(int(ME)), result=Sent("x", 1))  # a username that turns out to be you
        store, sync = self.send(new_chat_row("someone"), client)
        sync.send_outbox(client)
        self.assertEqual(store.failed, [("n1", OWN_USERNAME)])

    def test_rows_for_other_accounts_are_left_alone(self):
        client = NewChatClient(user=User(200), result=Sent("x", 1))
        store, sync = self.send(new_chat_row(account_id="a2"), client)
        sync.send_outbox(client)
        self.assertEqual((store.claimed, client.sent), ([], []))

    def test_an_unknown_username_is_said_plainly_and_the_account_carries_on(self):
        client = NewChatClient(lookup_error=UserNotFound())
        store, sync = self.send(new_chat_row(), client)
        sync.send_outbox(client)
        self.assertEqual(store.failed, [("n1", NO_SUCH_USER)])
        self.assertEqual(client.sent, [])

    def test_a_lookup_that_fails_sends_nothing(self):
        client = NewChatClient(lookup_error=UnknownError())
        store, sync = self.send(new_chat_row(), client)
        sync.send_outbox(client)
        self.assertEqual(store.failed, [("n1", LOOKUP_FAILED)])
        self.assertEqual(client.sent, [])
        client = NewChatClient(lookup_error=LoginRequired())  # an account problem still stops the account
        store, sync = self.send(new_chat_row(), client)
        with self.assertRaises(LoginRequired):
            sync.send_outbox(client)
        self.assertEqual(store.failed, [("n1", LOOKUP_FAILED)])

    def test_a_failed_first_message_is_never_retried(self):
        client = NewChatClient(user=User(200), error=FeedbackRequired())
        store, sync = self.send(new_chat_row(), client)
        with self.assertRaises(FeedbackRequired):
            sync.send_outbox(client)
        self.assertEqual(store.failed, [("n1", MAY_HAVE_SENT)])
        self.assertEqual(store.settled, [])

    def test_a_sent_message_without_a_thread_is_settled_and_left_for_the_poll(self):
        client = NewChatClient(user=User(200), result=Sent("item7", None))
        store, sync = self.send(new_chat_row(), client)
        sync.send_outbox(client)
        self.assertEqual(store.settled, [("n1", "item7")])
        self.assertEqual((store.ingested, store.linked), ([], []))

    def test_replies_still_go_to_their_thread(self):
        store, client = FakeStore([outbox_row()]), NewChatClient(result=Item_("item1"))
        account_sync(store).send_outbox(client)
        self.assertEqual(client.sent, [("See you at 10", [], [340282366841710300949128])])


class Actions(unittest.TestCase):
    def test_seen_only_for_the_thread_you_opened(self):
        action = {"id": "x1", "user_id": "u1", "thread_id": "t1", "action": "read", "threads": {"provider_thread_id": "3402"}}
        store = FakeStore(actions=[action], receipts=[{"id": "m2", "provider_message_id": "item2"}, {"id": "m1", "provider_message_id": "item1"}])
        client = SendClient()
        account_sync(store).apply_actions(client)
        self.assertEqual(client.seen, [("3402", "item2")])  # one call, at the newest message
        self.assertEqual(store.receipt_states, [(["m2", "m1"], "sent")])
        self.assertEqual(store.finished, [("x1", None)])

    def test_nothing_pending_sends_nothing(self):
        store, client = FakeStore(actions=[{"id": "x1", "user_id": "u1", "thread_id": "t1", "action": "read", "threads": {}}]), SendClient()
        account_sync(store).apply_actions(client)
        self.assertEqual(client.seen, [])

    def test_app_only_actions_and_reactions(self):
        store, client = FakeStore(actions=[{"id": "x1", "action": "archive"}, {"id": "x2", "action": "react"}]), SendClient()
        account_sync(store).apply_actions(client)
        self.assertEqual(store.finished[0], ("x1", None))
        self.assertEqual(store.finished[1][0], "x2")
        self.assertIsNotNone(store.finished[1][1])
        self.assertEqual(client.seen, [])


class PollClient(SendClient):
    def __init__(self, pages):
        super().__init__()
        self.pages = list(pages)
        self.requests = []

    def private_request(self, endpoint, params=None):
        self.requests.append((endpoint, params))
        return self.pages.pop(0) if self.pages else {"inbox": {"threads": [], "has_older": False}}


class Polling(unittest.TestCase):
    def inbox(self, threads):
        return {"inbox": {"threads": threads, "has_older": False}}

    def test_first_poll_imports_history_without_resurfacing(self):
        t = raw_thread([item("text", 0, text="Hello"), item("text", 1, user=ME, text="Hi")], last_seen_at={ME: {"timestamp": str(T0 + 5_000_000)}})
        store, client = FakeStore(), PollClient([self.inbox([t])])
        stored = account_sync(store).poll(client)
        self.assertEqual(stored, 1)
        self.assertEqual(client.requests[0][0], "direct_v2/inbox/")
        self.assertEqual([p["provider_message_id"] for p in store.ingested], ["item0", "item1"])  # oldest first
        self.assertFalse(any(p["resurface"] for p in store.ingested))
        self.assertTrue(all(p["is_read"] for p in store.ingested))
        self.assertEqual(store.marked, [["340282366841710300949128"]])  # seen on the phone
        self.assertEqual(store.newest, T0 + 1_000_000)

    def test_later_polls_store_only_what_is_new(self):
        t = raw_thread([item("text", 0), item("text", 1), item("text", 2, text="New one")], last_seen_at={ME: {"timestamp": str(T0 + 1_000_000)}})
        store = FakeStore()
        store.newest = T0 + 1_000_000
        client = PollClient([self.inbox([t])])
        account_sync(store).poll(client)
        self.assertEqual([p["provider_message_id"] for p in store.ingested], ["item2"])
        self.assertTrue(store.ingested[0]["resurface"])
        self.assertFalse(store.ingested[0]["is_read"])
        self.assertEqual(store.marked, [[]])
        self.assertEqual([r[0] for r in client.requests], ["direct_v2/inbox/", "direct_v2/inbox/", "direct_v2/pending_inbox/"])  # no thread was opened

    def test_general_and_requests_are_read_too(self):
        general = raw_thread([item("text", 0, text="From general")])
        request = raw_thread([item("text", 1, text="From a stranger")])
        store = FakeStore()
        client = PollClient([self.inbox([]), self.inbox([general]), self.inbox([request])])
        stored = account_sync(store).poll(client)
        self.assertEqual(stored, 2)
        self.assertEqual([r[0] for r in client.requests], ["direct_v2/inbox/", "direct_v2/inbox/", "direct_v2/pending_inbox/"])
        self.assertEqual(client.requests[1][1]["folder"], "1")
        self.assertEqual(set(store.scoped), {"instagram_inbox_general", "instagram_inbox_requests"})

    def test_quiet_threads_are_left_alone(self):
        store = FakeStore()
        store.newest = T0 + 9_000_000
        account_sync(store).poll(PollClient([self.inbox([raw_thread([item("text", 0)])])]))
        self.assertEqual(store.ingested, [])


if __name__ == "__main__":
    unittest.main()
