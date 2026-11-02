"""The helper's commands: one account's LinkedIn session behind the stdin and stdout protocol.

Dispatch runs a command and returns its response; the wait for approval in the LinkedIn app answers later, from
its own thread, so the commands that can end the wait (another way, stop) still get through. The LinkedIn calls
are the client's (client.py), so this is tested with a fake."""

from __future__ import annotations

import base64
import json
import os
import re
import tempfile
import threading
import time
import uuid
from typing import Callable, Optional

from . import files, profile, wire
from .client import Api, Checkpoint, Factory, SignedIn
from .wire import done, error, fail

# A Google sign-in cookie that does not parse as a cookie.
G_STATE = re.compile(r"g_state=\{.*?\};?")
NO_SIGNIN_CMDS = {"login", "signin", "code", "app", "another_way", "stop"}


def cookie_value(header: str, name: str) -> str:
    for part in header.split(";"):
        k, _, v = part.strip().partition("=")
        if k == name: return v.strip('"') if name == "JSESSIONID" else v
    return ""


def signin_state(cp: Checkpoint) -> Optional[dict]:
    """What a sign-in is waiting at, as a result, or None for a page that asks for neither a code nor an approval."""
    if cp.kind in ("email", "sms", "totp"): return {"state": "code", "method": cp.kind}
    if cp.kind == "app": return {"state": "app", "canTryAnotherWay": bool(cp.can_try_another_way)}
    return None


class Helper:
    def __init__(self, write: Callable[[dict], None], factory: Factory, temp_root: Optional[str] = None) -> None:
        self.write, self.factory = write, factory
        self.temp_root = temp_root or tempfile.gettempdir()
        self.api: Optional[Api] = None
        self.me: dict = {}
        self.live = False
        self.checkpoint: Optional[Checkpoint] = None
        self.lock = threading.Lock()
        self.cancel: Optional[threading.Event] = None
        self.waiter: Optional[threading.Thread] = None

    # Sign-in

    def end_wait(self) -> None:
        """Ends a wait for approval in the app, if one is running, and returns once it has answered."""
        with self.lock: cancel, waiter, self.cancel, self.waiter = self.cancel, self.waiter, None, None
        if cancel: cancel.set()
        if waiter: waiter.join()

    def sign_in_response(self, id: int, step: Callable[[], SignedIn]) -> dict:
        """Runs a sign-in step: signed in, waiting at a check that wants a code or an approval (a wrong code lands
        here too, marked rejected), or failed."""
        try:
            s = step()
        except Exception as e:
            cp = getattr(e, "checkpoint", None)
            state = signin_state(cp) if cp is not None else None
            if state is not None:
                with self.lock: self.checkpoint = cp
                if getattr(e, "kind", "") == wire.REJECTED: state["rejected"] = True
                return done(id, state)
            return fail(id, wire.classify_signin(e))
        with self.lock: self.checkpoint = None
        return done(id, {"state": "done", "cookies": s.cookies, "headers": s.headers})

    def wait_for_app(self, req: dict) -> Optional[dict]:
        cp = self.checkpoint
        if cp is None or cp.kind != "app": return fail(req.get("id", 0), error(wire.BAD_REQUEST))
        self.end_wait()
        cancel = threading.Event()
        t = threading.Thread(target=lambda: self.write(self.sign_in_response(req.get("id", 0), lambda: cp.wait_for_app(cancel))), daemon=True)
        with self.lock: self.cancel, self.waiter = cancel, t
        t.start()
        return None

    # Commands

    def drop(self) -> None:
        """Ends the real-time stream of the current login, if any, and forgets it, so a new one (or none) starts clean."""
        api, self.api, self.me, self.live = self.api, None, {}, False
        if api is not None:
            try: api.close()
            except Exception: pass

    def dispatch(self, req: dict) -> tuple[Optional[dict], bool]:
        """Runs one command. The response is None when it comes later; the flag says the helper should exit."""
        if req.get("cmd") == "app": return self.wait_for_app(req), False
        return self.handle(req)

    def handle(self, req: dict) -> tuple[dict, bool]:
        id, cmd = req.get("id", 0), req.get("cmd")
        args = req.get("args") if isinstance(req.get("args"), dict) else {}
        bad = lambda: (fail(id, error(wire.BAD_REQUEST)), False)
        if cmd not in NO_SIGNIN_CMDS and self.api is None: return bad()
        try:
            if cmd == "signin":
                email, password, proxy = str(args.get("email") or ""), str(args.get("password") or ""), str(args.get("proxy") or "").strip()
                if not email.strip() or not password or not proxy_ok(proxy): return bad()
                self.end_wait()
                return self.sign_in_response(id, lambda: self.factory.password_login(email, password, proxy)), False
            if cmd in ("code", "another_way"):
                cp = self.checkpoint
                code = str(args.get("code") or "").strip()
                if cp is None or (cmd == "code" and not code): return bad()
                self.end_wait()
                return self.sign_in_response(id, (lambda: cp.submit_code(code)) if cmd == "code" else cp.try_another_way), False
            if cmd == "login": return self.login(id, args), False
            if cmd == "conversations":
                before = int(args.get("before") or 0) or now_ms()
                return done(id, {"conversations": self.api.conversations_before(before)}), False
            if cmd == "changes":
                r = self.api.changes() or {}
                return done(id, {"conversations": r.get("conversations") or [], "deleted": r.get("deleted") or [], "syncToken": r.get("syncToken") or ""}), False
            if cmd == "messages":
                conv = str(args.get("conversation") or "")
                if not conv: return bad()
                count = int(args.get("count") or 0)
                count = count if 0 < count <= 40 else 20
                return done(id, {"messages": self.api.messages_before(conv, int(args.get("before") or 0) or now_ms(), count)}), False
            if cmd == "send": return self.send(id, args), False
            if cmd == "start": return self.start(id, args), False
            if cmd == "picture":
                url = str(args.get("url") or "")
                if not files.picture_host(url): return bad()
                data, media = files.fetch_picture(url.strip())
                return done(id, {"data": base64.b64encode(data).decode(), "type": media}), False
            if cmd == "read":
                conv = str(args.get("conversation") or "")
                if not conv: return bad()
                self.api.mark_read(conv)
                return done(id, {}), False
            if cmd == "connect":
                if not self.live: self.api.connect(self.write); self.live = True
                return done(id, {}), False
            if cmd == "stop":
                self.end_wait(); self.drop()
                return done(id, {}), True
        except ValueError:  # a picture that is not one; a bad number in the args
            return fail(id, error(wire.FAILED)), False
        except Exception as e:
            return fail(id, wire.classify(e)), False
        return bad()

    def login(self, id: int, args: dict) -> dict:
        cookies = G_STATE.sub("", str(args.get("cookies") or ""))
        if not cookies.strip(): return fail(id, error(wire.BAD_REQUEST))
        self.drop()  # a new login replaces the old one, and a failed one leaves none
        if not cookie_value(cookies, "li_at") or not cookie_value(cookies, "JSESSIONID"): return fail(id, error(wire.BAD_CREDENTIALS))
        try:
            me, api = self.factory.open(cookies, args.get("headers") or {}, str(args.get("pageInstance") or ""), str(args.get("xLiTrack") or ""), str(args.get("syncToken") or ""))
        except Exception as e:
            return fail(id, wire.classify(e) if isinstance(e, (wire.ResponseError, wire.TokenInvalidated)) else wire.classify_signin(e) if isinstance(e, wire.SignInError) else error(wire.FAILED))
        if not me.get("id"):
            api.close()
            return fail(id, error(wire.BAD_CREDENTIALS))
        self.api, self.me = api, me
        return done(id, {"me": me})

    def send(self, id: int, args: dict) -> dict:
        conv, text, token = str(args.get("conversation") or ""), str(args.get("text") or ""), str(args.get("token") or "")
        atts = args.get("attachments") or []
        if not conv or not token or (not text.strip() and not atts): return fail(id, error(wire.BAD_REQUEST))
        if not atts: return done(id, {"message": self.api.send_message(conv, text, token)})
        checked, bad = files.check_attachments(atts, self.temp_root)
        if bad: return fail(id, bad)
        sent, err = self.send_files(conv, text, token, checked, 0)
        if err is not None: return self.send_failure(id, sent, err)
        return done(id, {"message": sent[0], "messages": sent})

    def send_files(self, conv: str, text: str, token: str, atts: list[dict], first: int) -> tuple[list[dict], Optional[Exception]]:
        """Uploads and sends files to a conversation, one message each, the text with the first. Returns the messages
        that went out and the error that stopped it, if any (the messages before it did go)."""
        sent: list[dict] = []
        for i, a in enumerate(atts):
            try:
                with open(a["path"], "rb") as f: render = self.api.upload(a["kind"], a["name"], a["mime"], a["size"], f)
                sent.append(self.api.send_message(conv, text if i == 0 else "", files.file_token(token, first + i), render))
            except Exception as e:
                return sent, e
        return sent, None

    @staticmethod
    def send_failure(id: int, sent: list, exc: Exception) -> dict:
        """partial when some of the send's messages are already on LinkedIn: the worker must not send the rest again unasked."""
        return fail(id, error(wire.PARTIAL, sent=len(sent))) if sent else fail(id, wire.classify(exc))

    def start(self, id: int, args: dict) -> dict:
        ref = profile.parse_profile(str(args.get("profile") or ""))
        text, token, atts = str(args.get("text") or ""), str(args.get("token") or ""), args.get("attachments") or []
        if ref is None or (not text.strip() and not atts) or not token: return fail(id, error(wire.BAD_REQUEST))
        checked: list[dict] = []
        if atts:
            checked, bad = files.check_attachments(atts, self.temp_root)
            if bad: return fail(id, bad)
        to = {"id": ref.get("id", ""), "urn": profile.PROFILE_PREFIX + ref.get("id", ""), "kind": "member"}
        try:
            if not ref.get("id"):
                picked, perr = profile.pick_profile(self.api.search(ref["name"]), ref["name"])
                if perr: return fail(id, perr)
                to = picked
            if to["id"] == self.me.get("id"): return fail(id, error(wire.BAD_REQUEST))
            render = None
            if checked:  # the first file opens the conversation with the text; any others follow in it
                with open(checked[0]["path"], "rb") as f: render = self.api.upload(checked[0]["kind"], checked[0]["name"], checked[0]["mime"], checked[0]["size"], f)
            m = self.api.start_conversation(self.me["id"], to["id"], text, token, render)
        except Exception as e:
            return fail(id, wire.classify(e))
        if not m.get("conversationUrn"): return fail(id, error(wire.FAILED))
        more: list[dict] = []
        if len(checked) > 1:
            more, err = self.send_files(m["conversationUrn"], "", token, checked[1:], 1)
            if err is not None: return fail(id, error(wire.PARTIAL, sent=1 + len(more)))  # the conversation and its first message exist
        me = self.me
        first = m if m.get("sender") else {**m, "sender": me}
        conv = {"urn": m["conversationUrn"], "read": True, "group": False, "lastActivityAt": m.get("deliveredAt", 0), "participants": [me, to], "messages": [first, *more]}
        return done(id, {"conversation": conv, "message": first})


def now_ms() -> int: return int(time.time() * 1000)


def proxy_ok(raw: str) -> bool:
    """Only http, https and socks5 proxies are taken; empty means none."""
    if not raw: return True
    from urllib.parse import urlsplit
    try: u = urlsplit(raw)
    except ValueError: return False
    return bool(u.hostname) and u.scheme in ("http", "https", "socks5", "socks5h")
