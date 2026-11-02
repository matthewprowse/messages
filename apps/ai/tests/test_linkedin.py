"""The LinkedIn helper (ai/connectors/linkedin): its commands against a fake client, plus the pure checks on
profiles, attachments, pictures and errors. No network; the real LinkedIn client does not exist yet, so what is
pinned here is the stdin and stdout protocol apps/linkedin/README.md describes."""

import io
import json
import os
import tempfile
import threading
import unittest

from ai.connectors.linkedin import files, profile, wire
from ai.connectors.linkedin.client import SignedIn, UnavailableFactory
from ai.connectors.linkedin.helper import Helper
from ai.connectors.linkedin.run import main

ME = {"id": "ACoAAme", "urn": "urn:li:fsd_profile:ACoAAme", "kind": "member", "firstName": "Matt"}
MSG = {"urn": "urn:li:msg_message:1", "conversationUrn": "urn:li:msg_conversation:c1", "deliveredAt": 5, "text": "hi"}


class FakeCheckpoint:
    def __init__(self, kind="totp", good="123456", then=None):
        self.kind, self.can_try_another_way, self.good, self.then, self.approved = kind, True, good, then, threading.Event()

    def submit_code(self, code):
        if code != self.good: raise wire.SignInError(wire.REJECTED, checkpoint=self)
        return SignedIn("li_at=a; JSESSIONID=\"ajax:1\"", {"User-Agent": ["UA"]})

    def try_another_way(self): raise wire.SignInError(wire.CHALLENGE, 200, "x", checkpoint=FakeCheckpoint("email"))

    def wait_for_app(self, cancel):
        while not (cancel.is_set() or self.approved.is_set()): cancel.wait(0.01)
        if cancel.is_set(): raise wire.SignInError(wire.CANCELLED)
        return SignedIn("li_at=a; JSESSIONID=\"ajax:1\"", {})


class FakeApi:
    def __init__(self): self.sent, self.uploads, self.closed, self.fail_at = [], [], False, None

    def conversations_before(self, before): return [{"urn": "c", "before": before}]
    def changes(self): return {"conversations": [], "deleted": ["urn:x"], "syncToken": "t"}
    def messages_before(self, c, before, count): return [{"count": count}]

    def send_message(self, c, text, token, render=None):
        if self.fail_at is not None and len(self.sent) == self.fail_at: raise wire.ResponseError(429)
        self.sent.append((c, text, token, render))
        return {**MSG, "text": text, "urn": f"urn:m{len(self.sent)}"}

    def upload(self, kind, name, mime, size, data): self.uploads.append((kind, name, data.read())); return {"file": name}
    def search(self, name): return [{"id": "ACoAAjane", "firstName": "Jane", "lastName": "Doe"}]

    def start_conversation(self, me, to, text, token, render=None):
        self.sent.append((to, text, token, render))
        return {**MSG, "text": text}

    def mark_read(self, c): self.sent.append(("read", c))
    def connect(self, on_event): on_event({"event": "connected"})
    def close(self): self.closed = True


class FakeFactory:
    def __init__(self, api=None): self.api, self.cp = api or FakeApi(), FakeCheckpoint()

    def password_login(self, email, password, proxy): raise wire.SignInError(wire.REJECTED, checkpoint=self.cp)
    def open(self, cookies, headers, page, track, sync): return ME, self.api


def session(factory=None, root=None):
    out = []
    h = Helper(out.append, factory or FakeFactory(), root)
    def run(cmd, **args):
        resp, stop = h.dispatch({"id": len(out) + 1, "cmd": cmd, "args": args})
        return resp
    return h, out, run


PIC = "https://media.licdn.com/a"
LOGIN = {"cookies": "li_at=abc; JSESSIONID=\"ajax:1\"; g_state={\"x\":1};"}


class Commands(unittest.TestCase):
    def test_nothing_runs_before_login(self):
        _, _, run = session()
        for cmd in ("conversations", "send", "connect", "read", "start", "picture"):
            self.assertEqual(run(cmd)["error"], {"kind": "bad_request"}, cmd)

    def test_login_needs_both_cookies_and_a_who(self):
        _, _, run = session()
        self.assertEqual(run("login", cookies="li_at=abc")["error"]["kind"], "bad_credentials")
        self.assertEqual(run("login", cookies="")["error"]["kind"], "bad_request")
        self.assertEqual(run("login", **LOGIN)["result"], {"me": ME})

    def test_a_failed_login_leaves_no_session(self):
        h, _, run = session()
        run("login", **LOGIN)
        run("login", cookies="li_at=abc")
        self.assertIsNone(h.api)
        self.assertEqual(run("conversations")["error"]["kind"], "bad_request")

    def test_login_with_the_unavailable_client_says_unsupported(self):
        _, _, run = session(UnavailableFactory())
        self.assertEqual(run("login", **LOGIN)["error"]["kind"], "unsupported")

    def test_reading(self):
        _, _, run = session()
        run("login", **LOGIN)
        self.assertEqual(run("messages", conversation="c", count=500)["result"], {"messages": [{"count": 20}]})
        self.assertEqual(run("messages", conversation="c", count=7)["result"], {"messages": [{"count": 7}]})
        self.assertEqual(run("messages")["error"]["kind"], "bad_request")
        self.assertEqual(run("changes")["result"]["syncToken"], "t")
        self.assertEqual(run("conversations", before=9)["result"]["conversations"][0]["before"], 9)

    def test_send_text_and_errors(self):
        h, _, run = session()
        run("login", **LOGIN)
        self.assertEqual(run("send", conversation="c", text="hi", token="t")["result"]["message"]["text"], "hi")
        self.assertEqual(run("send", conversation="c", text="  ", token="t")["error"]["kind"], "bad_request")
        self.assertEqual(run("send", conversation="c", text="hi")["error"]["kind"], "bad_request")
        h.api.fail_at = 1
        self.assertEqual(run("send", conversation="c", text="hi", token="t")["error"], {"kind": "rate_limited", "status": 429})

    def test_stop_drops_the_session_and_exits(self):
        h, _, _ = session()
        h.dispatch({"id": 1, "cmd": "login", "args": LOGIN})
        api = h.api
        resp, stop = h.dispatch({"id": 2, "cmd": "stop"})
        self.assertTrue(stop and resp["ok"] and api.closed and h.api is None)

    def test_connect_once(self):
        _, out, run = session()
        run("login", **LOGIN)
        run("connect"); run("connect")
        self.assertEqual([o for o in out if o.get("event")], [{"event": "connected"}])


class SignIn(unittest.TestCase):
    def test_password_then_wrong_then_right_code(self):
        _, _, run = session()
        self.assertEqual(run("signin", email="a@b.c", password="pw")["result"], {"state": "code", "method": "totp", "rejected": True})
        self.assertEqual(run("code", code="000000")["result"], {"state": "code", "method": "totp", "rejected": True})
        r = run("code", code=" 123456 ")["result"]
        self.assertEqual((r["state"], r["headers"]), ("done", {"User-Agent": ["UA"]}))
        self.assertEqual(run("code", code="123456")["error"]["kind"], "bad_request")  # nothing is waiting any more

    def test_bad_signin_args(self):
        _, _, run = session()
        for a in ({"email": "", "password": "x"}, {"email": "a@b.c", "password": ""}, {"email": "a@b.c", "password": "x", "proxy": "ftp://h"}):
            self.assertEqual(run("signin", **a)["error"]["kind"], "bad_request")

    def test_app_wait_answers_later_and_another_way_ends_it(self):
        f = FakeFactory(); f.cp = FakeCheckpoint("app")
        h, out, run = session(f)
        self.assertEqual(run("signin", email="a@b.c", password="pw")["result"], {"state": "app", "canTryAnotherWay": True, "rejected": True})
        self.assertIsNone(run("app"))
        self.assertEqual(run("another_way")["result"], {"state": "code", "method": "email"})
        self.assertEqual([o for o in out if o.get("error")][0]["error"]["kind"], "cancelled")  # the wait that was ended

    def test_app_approved(self):
        f = FakeFactory(); f.cp = FakeCheckpoint("app")
        h, out, run = session(f)
        run("signin", email="a@b.c", password="pw")
        run("app"); f.cp.approved.set(); h.waiter.join()
        self.assertEqual(out[-1]["result"]["state"], "done")

    def test_app_needs_an_app_check(self):
        _, _, run = session()
        self.assertEqual(run("app")["error"]["kind"], "bad_request")


class Start(unittest.TestCase):
    def test_a_name_must_match_one_person_and_is_never_guessed(self):
        _, _, run = session()
        run("login", **LOGIN)
        r = run("start", profile="https://www.linkedin.com/in/jane-doe-1a2b3c4d/", text="hello", token="t")["result"]
        self.assertEqual(r["conversation"]["participants"][1]["id"], "ACoAAjane")
        self.assertEqual(r["message"]["sender"], ME)
        self.assertEqual(run("start", profile="Someone Else", text="hello", token="t")["error"]["kind"], "not_found")

    def test_not_yourself_and_not_empty(self):
        _, _, run = session()
        run("login", **LOGIN)
        self.assertEqual(run("start", profile=ME["urn"], text="hi", token="t")["error"]["kind"], "bad_request")
        self.assertEqual(run("start", profile="urn:li:fsd_profile:ACoAAx", text="", token="t")["error"]["kind"], "bad_request")

    def test_files_open_the_chat_then_follow(self):
        with tempfile.TemporaryDirectory() as root:
            paths = []
            for i in range(3):
                p = os.path.join(root, f"f{i}.pdf"); open(p, "wb").write(b"x" * (i + 1)); paths.append({"path": p, "name": f"f{i}.pdf", "mime": "application/pdf", "kind": "file"})
            h, _, run = session(root=root)
            run("login", **LOGIN)
            r = run("start", profile="urn:li:fsd_profile:ACoAAx", text="", token="tok", attachments=paths)["result"]
            self.assertEqual(len(r["conversation"]["messages"]), 3)
            tokens = [s[2] for s in h.api.sent]
            self.assertEqual(tokens[0], "tok"); self.assertEqual(len(set(tokens)), 3)

    def test_send_files_partial(self):
        with tempfile.TemporaryDirectory() as root:
            ps = []
            for i in range(3):
                p = os.path.join(root, f"f{i}"); open(p, "wb").write(b"x"); ps.append({"path": p, "name": f"f{i}", "mime": "", "kind": "image"})
            h, _, run = session(root=root)
            run("login", **LOGIN)
            h.api.fail_at = 2
            self.assertEqual(run("send", conversation="c", text="t", token="k", attachments=ps)["error"], {"kind": "partial", "sent": 2})
            h.api.fail_at, h.api.sent = 0, []
            self.assertEqual(run("send", conversation="c", text="t", token="k", attachments=ps)["error"]["kind"], "rate_limited")


class Pure(unittest.TestCase):
    def test_parse_profile(self):
        p = profile.parse_profile
        self.assertEqual(p("urn:li:fsd_profile:ACoAA1"), {"id": "ACoAA1"})
        self.assertIsNone(p("urn:li:fsd_profile:"))
        self.assertEqual(p("linkedin.com/in/jos%C3%A9-pe%C3%B1a-12ab"), {"name": "josé peña"})
        self.assertEqual(p("Jane Doe"), {"name": "Jane Doe"})
        for bad in ("", "https://evil.com/in/jane", "https://www.linkedin.com/company/x", "a/b", "https://notlinkedin.com/in/x"):
            self.assertIsNone(p(bad), bad)

    def test_pick_profile(self):
        r = lambda i, f, l: {"id": i, "firstName": f, "lastName": l}
        got, err = profile.pick_profile([r("1", "José", "Peña"), r("2", "Jose", "Pena Jr")], "jose pena")
        self.assertEqual((got["id"], err), ("1", None))
        self.assertEqual(profile.pick_profile([r("1", "A", "B"), r("2", "a", "b"), r("2", "a", "b")], "a b")[1], {"kind": "ambiguous"})
        self.assertEqual(profile.pick_profile([r("1", "A", "B"), r("1", "A", "B")], "a b")[0]["id"], "1")
        self.assertEqual(profile.pick_profile([], "a b")[1], {"kind": "not_found"})

    def test_classify(self):
        c = lambda s: wire.classify(wire.ResponseError(s))
        self.assertEqual([c(s)["kind"] for s in (401, 302, 429, 999, 403, 404, 500)], ["bad_credentials", "bad_credentials", "rate_limited", "refused", "forbidden", "bad_request", "failed"])
        self.assertEqual(wire.classify(wire.TokenInvalidated()), {"kind": "bad_credentials"})
        self.assertEqual(wire.classify(RuntimeError("secret")), {"kind": "failed"})
        self.assertEqual(wire.classify_signin(wire.SignInError("blocked", 403, "authenticate")), {"kind": "blocked", "status": 403, "stage": "authenticate"})
        self.assertEqual(wire.classify_signin(wire.SignInError("weird"))["kind"], "failed")

    def test_attachment_checks(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as other:
            ok = os.path.join(root, "a.txt"); open(ok, "w").write("x")
            empty = os.path.join(root, "e.txt"); open(empty, "w").close()
            outside = os.path.join(other, "o.txt"); open(outside, "w").write("x")
            link = os.path.join(root, "l.txt"); os.symlink(outside, link)
            a = lambda path, kind="file", name="n": [{"path": path, "name": name, "kind": kind}]
            self.assertEqual(files.check_attachments(a(ok), root)[0][0]["mime"], "application/octet-stream")
            for bad in (a(empty), a(outside), a(link), a(ok, "audio"), a(ok, name=" "), a("a.txt"), [], a(os.path.join(root, "missing")), a(root)):
                self.assertEqual(files.check_attachments(bad, root)[1], {"kind": "bad_request"})
            self.assertIsNotNone(files.check_attachments(a(ok) * 11, root)[1])

    def test_picture_host_and_fetch(self):
        for good in ("https://media.licdn.com/dms/image/x", "https://licdn.com/a"): self.assertTrue(files.picture_host(good), good)
        for bad in ("http://media.licdn.com/a", "https://evil.com/a", "https://licdn.com.evil.com/a", "https://u@media.licdn.com/a", "https://media.licdn.com:8443/a", "https://notlicdn.com/a"): self.assertFalse(files.picture_host(bad), bad)

        class Resp(io.BytesIO):
            def __init__(s, body, ctype): super().__init__(body); s.headers = {"Content-Type": ctype}
            def __enter__(s): return s
            def __exit__(s, *a): return False
        self.assertEqual(files.fetch_picture(PIC, lambda *_a, **_k: Resp(b"img", "image/jpeg; x=y")), (b"img", "image/jpeg"))
        with self.assertRaises(ValueError): files.fetch_picture(PIC, lambda *_a, **_k: Resp(b"<html>", "text/html"))
        with self.assertRaises(ValueError): files.fetch_picture(PIC, lambda *_a, **_k: Resp(b"x" * (files.MAX_PICTURE_BYTES + 1), "image/png"))

    def test_file_tokens(self):
        self.assertEqual(files.file_token("t", 0), "t")
        self.assertEqual(files.file_token("t", 1), files.file_token("t", 1))
        self.assertNotEqual(files.file_token("t", 1), files.file_token("t", 2))


class Loop(unittest.TestCase):
    def test_lines_in_lines_out(self):
        stdin = io.StringIO('{"id":1,"cmd":"login","args":{"cookies":"li_at=a; JSESSIONID=b"}}\nnot json\n{"id":3,"cmd":"stop"}\n{"id":4,"cmd":"stop"}\n')
        stdout = io.StringIO()
        main(FakeFactory(), stdin, stdout)
        lines = [json.loads(l) for l in stdout.getvalue().splitlines()]
        self.assertEqual(lines[0], {"event": "ready"})
        self.assertEqual(lines[1]["result"]["me"]["id"], "ACoAAme")
        self.assertEqual(lines[2], {"id": 0, "ok": False, "error": {"kind": "bad_request"}})
        self.assertEqual(lines[3], {"id": 3, "ok": True, "result": {}})
        self.assertEqual(len(lines), 4)  # stop ends it: the last line is never read


if __name__ == "__main__":
    unittest.main()
