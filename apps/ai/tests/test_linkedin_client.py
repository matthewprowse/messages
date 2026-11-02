"""The real LinkedIn client (ai/connectors/linkedin: mapping, session, api, realtime, factory) against made-up
responses shaped like the web app's traffic captured on 29 October 2026. No network and no real names, IDs or text: the
shapes are the ones LinkedIn sends, the values are invented. What is not pinned here, because it was not captured, is
marked UNVERIFIED in api.py and realtime.py."""

import email.message
import gzip
import io
import json
import threading
import unittest
import urllib.error
from urllib.parse import unquote, urlsplit

from ai.connectors.linkedin import mapping, wire
from ai.connectors.linkedin.api import VoyagerApi
from ai.connectors.linkedin.factory import VoyagerFactory
from ai.connectors.linkedin.realtime import Realtime
from ai.connectors.linkedin.session import Session, rest

PID = "ACoAAmeFake0001"
ME = {"id": PID, "urn": "urn:li:fsd_profile:" + PID, "kind": "member", "firstName": "Matt", "lastName": "Tester"}
CONV = f"urn:li:msg_conversation:(urn:li:fsd_profile:{PID},2-ZmFrZQ==)"
COOKIES = 'li_at=secretat; JSESSIONID="ajax:123"; bcookie="b"'


def text(t): return {"_type": "x", "attributes": [], "text": t}
def picture(root="https://media.example/p/"): return {"rootUrl": root, "artifacts": [{"width": 100, "height": 100, "fileIdentifyingUrlPathSegment": "small"}, {"width": 400, "height": 400, "fileIdentifyingUrlPathSegment": "big"}]}


def member(pid, first, last, headline="CEO"):
    return {"entityUrn": f"urn:li:msg_messagingParticipant:urn:li:fsd_profile:{pid}", "participantType": {"member": {"firstName": text(first), "lastName": text(last), "headline": text(headline), "profilePicture": picture()}, "organization": None}}


def company(cid, name):
    return {"entityUrn": f"urn:li:msg_messagingParticipant:urn:li:fsd_company:{cid}", "participantType": {"member": None, "organization": {"name": text(name), "logo": picture("https://media.example/logo/")}}}


def raw_message(n=1, body="Hello", sender=None, content=None):
    return {"entityUrn": f"urn:li:msg_message:(urn:li:fsd_profile:{PID},2-m{n})", "conversation": {"entityUrn": CONV}, "deliveredAt": 1_700_000_000_000 + n, "body": text(body), "sender": sender or member("ACoAAjane", "Jane", "Doe"), "actor": None, "messageBodyRenderFormat": "DEFAULT", "renderContent": content or []}


def raw_conversation(**kw):
    c = {"entityUrn": CONV, "title": None, "groupChat": False, "read": False, "lastActivityAt": 1_700_000_005_000, "lastReadAt": None, "categories": ["INBOX", "PRIMARY_INBOX"], "conversationParticipants": [member(PID, "Matt", "Tester"), member("ACoAAjane", "Jane", "Doe"), company("99", "Acme")], "messages": {"elements": [raw_message()]}}
    c.update(kw)
    return c


class FakeResp(io.BytesIO):
    def __init__(self, body=b"", status=200, headers=None, lines=None):
        super().__init__(body)
        self.status, self.headers, self.lines = status, email.message.Message(), lines
        for k, v in (headers or {}).items(): self.headers[k] = v
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def __iter__(self): return iter(self.lines) if self.lines is not None else super().__iter__()


class Wire:
    """A stand-in for the network: records every request and answers from a table of path fragments."""
    def __init__(self): self.calls, self.answers = [], []
    def on(self, fragment, body, status=200, gz=False, method=None):
        self.answers.append((fragment, method, body, status, gz)); return self
    def __call__(self, req, timeout=None):
        url, method = unquote(req.full_url), req.get_method()
        self.calls.append({"url": url, "method": method, "headers": {k.lower(): v for k, v in req.header_items()}, "body": req.data})
        for fragment, m, body, status, gz in self.answers:
            if fragment in url and (m is None or m == method):
                if status >= 300: raise urllib.error.HTTPError(url, status, "x", {}, None)
                raw = body if isinstance(body, bytes) else json.dumps(body).encode()
                return FakeResp(gzip.compress(raw) if gz else raw, headers={"Content-Encoding": "gzip"} if gz else None)
        raise AssertionError(f"unexpected request {method} {url}")


def api(wire_=None, sync=""):
    w = wire_ or Wire()
    return VoyagerApi(Session(COOKIES, {"User-Agent": ["UA/1"]}, "", "", w), ME, sync), w


class Mapping(unittest.TestCase):
    def test_conversation(self):
        c = mapping.conversation_from(raw_conversation())
        self.assertEqual((c["urn"], c["group"], c["read"], c["lastActivityAt"], c["categories"]), (CONV, False, False, 1_700_000_005_000, ["INBOX", "PRIMARY_INBOX"]))
        jane = next(p for p in c["participants"] if p["id"] == "ACoAAjane")
        self.assertEqual(jane, {"id": "ACoAAjane", "urn": "urn:li:fsd_profile:ACoAAjane", "kind": "member", "firstName": "Jane", "lastName": "Doe", "headline": "CEO", "picture": "https://media.example/p/big"})
        self.assertEqual(c["participants"][2], {"id": "99", "urn": "urn:li:fsd_company:99", "kind": "organization", "name": "Acme", "picture": "https://media.example/logo/big"})
        self.assertEqual(c["messages"][0]["sender"]["firstName"], "Jane")
        self.assertNotIn("title", c); self.assertNotIn("lastReadAt", c)

    def test_message_files_and_forward(self):
        m = mapping.message_from(raw_message(content=[{"file": {"name": "a.pdf", "mediaType": "application/pdf", "byteSize": 9}}, {"vectorImage": {"rootUrl": "x"}}, {"messageAdRenderContent": {"x": 1}}]))
        self.assertEqual(m["files"], [{"name": "a.pdf", "mediaType": "application/pdf", "size": 9}, {"name": "Photo.jpg", "mediaType": "image/jpeg"}])
        fwd = raw_message(body="", content=[{"forwardedMessage": {"forwardedBody": text("passed on")}}])
        self.assertEqual(mapping.message_from(fwd)["text"], "passed on")
        self.assertEqual(mapping.message_from({"entityUrn": "u", "body": None}, "c")["conversationUrn"], "c")

    def test_empty_and_odd_inputs_do_not_raise(self):
        self.assertIsNone(mapping.person_from({"entityUrn": ""}))
        self.assertIsNone(mapping.person_from(None))
        self.assertEqual(mapping.picture_url({"rootUrl": "r", "artifacts": []}), "")
        self.assertEqual(mapping.conversation_from({})["participants"], [])

    def test_me_and_typeahead(self):
        prof = {"data": {}, "included": [{"entityUrn": "urn:li:fs_miniProfile:" + PID, "firstName": " Matt ", "lastName": "Tester"}, {"entityUrn": "urn:li:other:1"}]}
        self.assertEqual(mapping.me_from(prof), ME)
        self.assertEqual(mapping.me_from({"included": []}), {})
        els = [{"targetEntityViewModel": {"title": text("Jane van Doe"), "entity": {"*profile": "urn:li:fsd_profile:ACoAAjane"}}}, {"targetEntityViewModel": {"title": text("A Group"), "entity": {}}}]
        self.assertEqual(mapping.people_from_typeahead(els), [{"id": "ACoAAjane", "firstName": "Jane", "lastName": "van Doe"}])

    def test_events_from_finds_messages_and_conversations(self):
        ev = {"payload": {"data": {"value": raw_message(7)}}}
        self.assertEqual([e["event"] for e in mapping.events_from(ev)], ["message"])
        ev = {"payload": {"data": {"x": [raw_conversation()]}}}
        self.assertEqual([e["event"] for e in mapping.events_from(ev)], ["conversation"])
        self.assertEqual(mapping.events_from({"payload": {"data": {"value": {"badgingItemCounts": []}}}}), [])
        self.assertEqual(mapping.events_from({}), [])


class SessionAndEncoding(unittest.TestCase):
    def test_rest_encoding_matches_the_web_apps(self):
        self.assertEqual(rest({"mailboxUrn": "urn:li:fsd_profile:ACoAAx"}), "(mailboxUrn:urn%3Ali%3Afsd_profile%3AACoAAx)")
        v = rest({"query": {"predicateUnions": [{"conversationCategoryPredicate": {"category": "PRIMARY_INBOX"}}]}, "count": 20, "lastUpdatedBefore": 5})
        self.assertEqual(v, "(query:(predicateUnions:List((conversationCategoryPredicate:(category:PRIMARY_INBOX)))),count:20,lastUpdatedBefore:5)")
        self.assertEqual(rest(["urn:li:msg_conversation:(a,b)"]), "List(urn%3Ali%3Amsg_conversation%3A%28a%2Cb%29)")

    def test_headers_carry_the_session_the_way_the_browser_does(self):
        w = Wire().on("/x", {})
        s = Session(COOKIES, {"User-Agent": ["UA/1"], "Sec-Ch-Ua": ["\"c\""]}, "", "", w)
        s.get_json("/x")
        h = w.calls[0]["headers"]
        self.assertEqual((h["csrf-token"], h["user-agent"], h["sec-ch-ua"], h["accept"], h["x-restli-protocol-version"]), ("ajax:123", "UA/1", '"c"', "application/graphql", "2.0.0"))
        self.assertIn("li_at=secretat", h["cookie"])
        self.assertEqual(json.loads(h["x-li-track"])["mpName"], "voyager-web")
        self.assertTrue(h["x-li-page-instance"].startswith("urn:li:page:"))

    def test_a_foreign_track_is_replaced_with_its_page_instance(self):
        s = Session(COOKIES, None, "urn:li:page:keep;1", json.dumps({"mpName": "other"}))
        self.assertEqual(json.loads(s.track)["mpName"], "voyager-web"); self.assertNotEqual(s.page, "urn:li:page:keep;1")
        s = Session(COOKIES, None, "urn:li:page:keep;1", json.dumps({"mpName": "voyager-web", "k": 1}))
        self.assertEqual(s.page, "urn:li:page:keep;1")

    def test_statuses_and_gzip_and_rotating_cookies(self):
        w = Wire().on("/a", {"ok": 1}, gz=True).on("/b", {}, status=302).on("/c", {}, status=429)
        s = Session(COOKIES, None, "", "", w)
        self.assertEqual(s.get_json("/a"), {"ok": 1})
        for path, status in (("/b", 302), ("/c", 429)):
            with self.assertRaises(wire.ResponseError) as cm: s.get_json(path)
            self.assertEqual(cm.exception.status, status)

    def test_set_cookie_replaces_and_deletes(self):
        s = Session(COOKIES, None, "", "")
        h = email.message.Message(); h["Set-Cookie"] = 'JSESSIONID="ajax:999"; Path=/'; h["Set-Cookie"] = "bcookie=delete; Max-Age=0"
        s.keep_cookies(h)
        self.assertEqual((s.csrf, "bcookie" in s.cookies, s.cookies["li_at"]), ("ajax:999", False, "secretat"))


class Calls(unittest.TestCase):
    def test_conversations_before_asks_for_the_primary_inbox_before_a_time(self):
        a, w = api()
        w.on("graphql", {"data": {"messengerConversationsByCategoryQuery": {"elements": [raw_conversation()]}}})
        out = a.conversations_before(1234)
        url = w.calls[0]["url"]
        self.assertIn("messengerConversations.9501074288a12f3ae9e3c7ea243bccbf", url)
        self.assertIn("lastUpdatedBefore:1234", url); self.assertIn("count:20", url); self.assertIn("mailboxUrn:urn:li:fsd_profile:" + PID, url)
        self.assertEqual(out[0]["urn"], CONV)

    def test_changes_first_call_then_by_token(self):
        a, w = api()
        w.on("messengerConversations.0d5e", {"data": {"messengerConversationsBySyncToken": {"metadata": {"newSyncToken": "T1", "deletedUrns": []}, "elements": [raw_conversation()]}}})
        w.on("messengerConversations.74c1", {"data": {"messengerConversationsBySyncToken": {"metadata": {"newSyncToken": "T2", "deletedUrns": ["urn:gone", {"conversationUrn": "urn:gone2"}, {}]}, "elements": []}}})
        first = a.changes()
        self.assertEqual((first["syncToken"], len(first["conversations"])), ("T1", 1))
        second = a.changes()
        self.assertEqual((second["syncToken"], second["deleted"]), ("T2", ["urn:gone", "urn:gone2"]))
        self.assertIn("syncToken:T1", w.calls[1]["url"])

    def test_messages_before(self):
        a, w = api()
        w.on("messengerMessages", {"data": {"messengerMessagesByAnchorTimestamp": {"elements": [raw_message(1), raw_message(2)]}}})
        out = a.messages_before(CONV, 99, 7)
        self.assertIn("deliveredAt:99", w.calls[0]["url"]); self.assertIn("countBefore:7", w.calls[0]["url"]); self.assertIn("countAfter:0", w.calls[0]["url"])
        self.assertEqual([m["text"] for m in out], ["Hello", "Hello"])

    def sent(self, n=1): return {"value": {"entityUrn": "urn:li:msg_message:(x," + str(n) + ")", "conversationUrn": CONV, "backendConversationUrn": "b", "senderUrn": "s", "originToken": "tok", "deliveredAt": 42, "body": text("hi"), "renderContentUnions": []}}

    def test_send_posts_text_with_the_token_and_returns_it_from_you(self):
        a, w = api()
        w.on("action=createMessage", self.sent())
        m = a.send_message(CONV, "hi", "tok")
        c = w.calls[0]
        body = json.loads(c["body"])
        self.assertEqual((c["method"], c["headers"]["content-type"], c["headers"]["origin"]), ("POST", "text/plain;charset=UTF-8", "https://www.linkedin.com"))
        self.assertEqual((body["message"]["body"]["text"], body["message"]["originToken"], body["mailboxUrn"], body["conversationUrn"], body["dedupeByClientGeneratedToken"]), ("hi", "tok", ME["urn"], CONV, True))
        self.assertNotIn("hostRecipientUrns", body); self.assertNotIn("renderContentUnions", body["message"])
        self.assertEqual((m["text"], m["conversationUrn"], m["deliveredAt"], m["sender"]), ("hi", CONV, 42, ME))

    def test_start_conversation_names_the_recipient_and_no_conversation(self):
        a, w = api()
        w.on("action=createMessage", self.sent())
        m = a.start_conversation(PID, "ACoAAjane", "hello", "tok2", {"file": {"name": "a"}})
        body = json.loads(w.calls[0]["body"])
        self.assertEqual(body["hostRecipientUrns"], ["urn:li:fsd_profile:ACoAAjane"]); self.assertNotIn("conversationUrn", body)
        self.assertEqual(body["message"]["renderContentUnions"], [{"file": {"name": "a"}}]); self.assertEqual(m["conversationUrn"], CONV)

    def test_a_failed_send_is_one_attempt(self):
        a, w = api()
        w.on("action=createMessage", {}, status=429)
        with self.assertRaises(wire.ResponseError): a.send_message(CONV, "hi", "t")
        self.assertEqual(len(w.calls), 1)

    def test_upload_asks_then_puts_the_bytes_and_returns_the_render(self):
        a, w = api()
        w.on("action=upload", {"data": {"value": {"urn": "urn:li:digitalmediaAsset:A1", "type": "SINGLE", "singleUploadUrl": "https://www.linkedin.com/dms-uploads/x?y=1", "singleUploadHeaders": {"media-type-family": "STILLIMAGE"}}}})
        w.on("dms-uploads", b"", method="PUT")
        r = a.upload("image", "p.jpg", "image/jpeg", 3, io.BytesIO(b"abc"))
        ask, put = w.calls
        self.assertEqual(json.loads(ask["body"]), {"mediaUploadType": "MESSAGING_PHOTO_ATTACHMENT", "fileSize": 3, "filename": "p.jpg"})
        self.assertEqual((put["method"], put["body"], put["headers"]["content-type"], put["headers"]["media-type-family"], put["headers"]["csrf-token"]), ("PUT", b"abc", "image/jpeg", "STILLIMAGE", "ajax:123"))
        self.assertEqual(r, {"file": {"assetUrn": "urn:li:digitalmediaAsset:A1", "byteSize": 3, "mediaType": "image/jpeg", "name": "p.jpg"}})

    def test_an_upload_address_off_linkedin_gets_no_credentials(self):
        from ai.connectors.linkedin.files import upload_host

        for bad in ("http://www.linkedin.com/u", "https://evil.com/u", "https://linkedin.com.evil.com/u", "https://u@www.linkedin.com/u", "https://www.linkedin.com:8443/u", "https://notlinkedin.com/u"):
            self.assertFalse(upload_host(bad), bad)
        for good in ("https://www.linkedin.com/dms-uploads/x", "https://dms.licdn.com/u", "https://linkedin.com/u"):
            self.assertTrue(upload_host(good), good)
        a, w = api()
        w.on("action=upload", {"data": {"value": {"urn": "u", "type": "SINGLE", "singleUploadUrl": "https://evil.example/put", "singleUploadHeaders": {}}}})
        with self.assertRaises(wire.ResponseError): a.upload("image", "p.jpg", "image/jpeg", 3, io.BytesIO(b"abc"))
        self.assertEqual(len(w.calls), 1)  # only the ask went out, with no PUT

    def test_a_multipart_upload_is_refused_not_guessed(self):
        a, w = api()
        w.on("action=upload", {"data": {"value": {"urn": "u", "type": "MULTIPART"}}})
        with self.assertRaises(wire.ResponseError): a.upload("file", "a.pdf", "application/pdf", 1, io.BytesIO(b"a"))
        self.assertEqual(len(w.calls), 1)

    def test_search(self):
        a, w = api()
        w.on("graphql", {"data": {"data": {"messagingDashMessagingTypeaheadByTypeaheadKeyword": {"elements": [{"targetEntityViewModel": {"title": text("Jane Doe"), "entity": {"*profile": "urn:li:fsd_profile:ACoAAjane"}}}]}}}})
        self.assertEqual(a.search("Jane Doe")[0]["id"], "ACoAAjane")
        self.assertIn("keyword:Jane Doe,types:List(CONNECTIONS,GROUP_THREADS,PEOPLE,COWORKERS)", w.calls[0]["url"])
        self.assertEqual(w.calls[0]["headers"]["accept"], "application/vnd.linkedin.normalized+json+2.1")

    def test_mark_read_patches_and_checks_the_answer(self):
        a, w = api()
        w.on("voyagerMessagingDashMessengerConversations", {"results": {CONV: {"status": 204}}, "errors": {}})
        a.mark_read(CONV)
        self.assertEqual(json.loads(w.calls[0]["body"]), {"entities": {CONV: {"patch": {"$set": {"read": True}}}}})
        self.assertIn("ids=List(" + CONV + ")", w.calls[0]["url"])
        w.answers.clear(); w.on("voyagerMessagingDashMessengerConversations", {"results": {CONV: {"status": 403}}, "errors": {}})
        with self.assertRaises(wire.ResponseError) as cm: a.mark_read(CONV)
        self.assertEqual(wire.classify(cm.exception)["kind"], "forbidden")

    def test_a_sign_out_reads_as_bad_credentials(self):
        a, w = api()
        w.on("graphql", {}, status=302)
        with self.assertRaises(wire.ResponseError) as cm: a.messages_before(CONV, 1, 5)
        self.assertEqual(wire.classify(cm.exception)["kind"], "bad_credentials")


class Factory(unittest.TestCase):
    def test_open_asks_who_you_are(self):
        w = Wire().on("/voyager/api/me", {"included": [{"entityUrn": "urn:li:fs_miniProfile:" + PID, "firstName": "Matt", "lastName": "Tester"}]})
        me, a = VoyagerFactory(w).open(COOKIES, {"User-Agent": ["UA/1"]}, "", "", "SYNC")
        self.assertEqual(me, ME); self.assertEqual(a.sync_token, "SYNC")
        self.assertEqual(w.calls[0]["headers"]["accept"], "application/vnd.linkedin.normalized+json+2.1")

    def test_expired_session_raises(self):
        with self.assertRaises(wire.ResponseError): VoyagerFactory(Wire().on("/me", {}, status=401)).open(COOKIES, {}, "", "", "")

    def test_password_sign_in_is_not_available_yet(self):
        with self.assertRaises(wire.SignInError) as cm: VoyagerFactory().password_login("a", "b", "")
        self.assertEqual(cm.exception.kind, "unsupported")


def sse(*objs): return [b"data: " + json.dumps(o).encode() + b"\n" for o in objs]


class RealtimeStream(unittest.TestCase):
    def run_stream(self, lines, status=None):
        events, w = [], Wire()
        w.on("realtimeFrontendClientConnectivityTracking", {})
        base = w.__call__
        def opener(req, timeout=None):
            if "/realtime/connect" in req.full_url:
                w.calls.append({"url": req.full_url, "headers": {k.lower(): v for k, v in req.header_items()}})
                if status: raise urllib.error.HTTPError(req.full_url, status, "x", {}, None)
                return FakeResp(lines=lines)
            return base(req, timeout)
        r = Realtime(Session(COOKIES, None, "", "", opener), events.append, sleep=lambda s: None)
        return r, events, w

    def test_events_become_the_helpers_events(self):
        lines = sse({"com.linkedin.realtimefrontend.ClientConnection": {"personalTopics": ["messagesTopic"]}}, {"com.linkedin.realtimefrontend.Heartbeat": {}},
                    {"com.linkedin.realtimefrontend.DecoratedEvent": {"topic": "t", "payload": {"data": {"value": raw_message(5, "live")}}}},
                    {"com.linkedin.realtimefrontend.DecoratedEvent": {"payload": {"data": {"value": {"badgingItemCounts": []}}}}}) + [b"\n", b": comment\n", b"data: not json\n"]
        r, events, w = self.run_stream(lines)
        self.assertTrue(r.stream()); r.stop()
        self.assertEqual([e["event"] for e in events], ["connected", "heartbeat", "message"])
        self.assertEqual(events[2]["message"]["text"], "live")

    def test_the_connect_request_asks_for_messaging_decoration(self):
        r, _, w = self.run_stream([])
        r.stream(); r.stop()
        h = w.calls[-1]["headers"]
        self.assertEqual((h["accept"], h["accept-encoding"], h["x-li-realtime-session"] == r.session_id), ("text/event-stream", "identity", True))
        self.assertIn("messagesTopic", json.loads(h["x-li-query-map"])["topicToGraphQLQueryParams"])
        self.assertTrue(w.calls[-1]["url"].endswith("/realtime/connect?rc=1"))

    def test_a_sign_out_ends_it_with_bad_credentials(self):
        r, events, _ = self.run_stream([], status=401)
        r.start(); r.join(5)
        self.assertEqual(events, [{"event": "bad_credentials", "error": {"kind": "bad_credentials", "status": 401}}])

    def test_repeated_failures_end_it_after_reconnecting(self):
        r, events, _ = self.run_stream([], status=500)
        r.start(); r.join(5)
        kinds = [e["event"] for e in events]
        self.assertEqual((kinds[:2], kinds[-1], kinds.count("reconnecting")), (["reconnecting", "reconnecting"], "failed", 7))

    def test_a_stream_that_connects_and_closes_at_once_still_counts_as_a_failure(self):
        r, events, _ = self.run_stream(sse({"com.linkedin.realtimefrontend.ClientConnection": {}}))
        r.start(); r.join(5)
        self.assertEqual(events[-1]["event"], "failed")  # it used to reset on every connect and loop for good

    def test_a_stream_that_stayed_up_resets_the_count(self):
        from unittest import mock
        from ai.connectors.linkedin import realtime

        r, events, _ = self.run_stream(sse({"com.linkedin.realtimefrontend.ClientConnection": {}}))
        ticks = iter(range(0, 10_000, 100))  # every read of the clock is 100 s later: each stream "lasted" long enough
        calls = []
        def wait(seconds):
            calls.append(seconds)
            if len(calls) >= 20: r.stopped.set()
        r.wait = wait
        with mock.patch.object(realtime.time, "monotonic", lambda: next(ticks)):
            r.start(); r.join(5)
        self.assertNotIn("failed", [e["event"] for e in events])
        self.assertEqual(set(calls), {2.0})

    def test_stop_ends_the_thread(self):
        r, events, _ = self.run_stream(sse({"com.linkedin.realtimefrontend.ClientConnection": {}}))
        r.stopped.set(); r.start(); r.join(5)
        self.assertFalse(r.is_alive())


if __name__ == "__main__":
    unittest.main()
