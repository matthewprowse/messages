"""One iCloud sign-in that makes an app-specific password, on stand-ins: no pyicloud, network or database.

The account page's answers follow what its JavaScript expects (2 November 2026): 200 with the new password,
451 to type the password again first, 466 when this Apple ID only makes them on a device."""

import threading
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace

from ai.connectors.icloud_reminders import account_site, setup
from ai.connectors.icloud_reminders.account_site import ACCOUNT_API, PASSWORDS_PATH, RECHECK_PATH, TOKEN_PATH, AccountSite, AppPasswordFailed, find_app_password
from ai.connectors.instagram.sealing import open_handoff, open_json, seal_handoff, seal_json

KEY = "A" * 43 + "="
AT = datetime(2026, 11, 2, 10, 0, 30, tzinfo=timezone.utc)  # 30 seconds after queued() was made
DASHES = "[" + chr(0x2013) + chr(0x2014) + "]"


class Reply:
    def __init__(self, status, data=None, text="", scnt=None):
        self.status_code = status
        self._data = data
        self.text = text
        self.headers = {"scnt": scnt} if scnt else {}

    def json(self):
        if self._data is None:
            raise ValueError("no json")
        return self._data


class FakeSend:
    """The signed-in session: answers by (method, path) from a script, and records every call."""

    def __init__(self, script):
        self.script = {k: list(v) for k, v in script.items()}
        self.calls = []

    def __call__(self, method, url, *, headers, json=None):
        path = url.replace(ACCOUNT_API, "").replace(account_site.ACCOUNT_PAGE, "page:")
        self.calls.append((method, path, dict(headers), json))
        replies = self.script.get((method, path)) or [Reply(404)]
        return replies.pop(0) if len(replies) > 1 else replies[0]


def site(script):
    send = FakeSend(script)
    return AccountSite(send, "fd"), send


PAGE = ("GET", "page:/account/manage")
TOKEN = ("GET", TOKEN_PATH)
MAKE = ("POST", PASSWORDS_PATH)
RECHECK = ("POST", RECHECK_PATH)


class FindingThePassword(unittest.TestCase):
    def test_named_field(self):
        self.assertEqual(find_app_password({"password": "abcd-efgh-ijkl-mnop", "id": 1}), "abcd-efgh-ijkl-mnop")

    def test_renamed_or_nested_field(self):
        self.assertEqual(find_app_password({"secondaryPassword": {"value": "abcd-efgh-ijkl-mnop"}}), "abcd-efgh-ijkl-mnop")
        self.assertEqual(find_app_password([{"x": "no"}, "abcd-efgh-ijkl-mnop"]), "abcd-efgh-ijkl-mnop")

    def test_nothing_shaped_like_one(self):
        self.assertIsNone(find_app_password({"password": "hunter2", "description": "Konva"}))
        self.assertIsNone(find_app_password(None))


class AccountPage(unittest.TestCase):
    def test_opens_with_the_page_scnt_and_keeps_the_newest(self):
        account, send = site({PAGE: [Reply(200, text='{"scnt": "first"}')], TOKEN: [Reply(200, {}, scnt="second")], MAKE: [Reply(200, {"password": "abcd-efgh-ijkl-mnop"})]})
        account.open()
        self.assertEqual(send.calls[1][2]["scnt"], "first")
        self.assertEqual(account.make("pw"), "abcd-efgh-ijkl-mnop")
        method, path, headers, body = send.calls[2]
        self.assertEqual((method, path, body), ("POST", PASSWORDS_PATH, {"description": "Konva"}))
        self.assertEqual(headers["scnt"], "second")
        self.assertEqual(headers["X-Apple-I-Request-Context"], "ca")

    def test_a_refused_token_is_untrusted(self):
        account, _ = site({PAGE: [Reply(200, text="")], TOKEN: [Reply(401)]})
        with self.assertRaises(AppPasswordFailed) as caught:
            account.open()
        self.assertEqual(caught.exception.code, "untrusted")

    def test_types_the_password_again_when_asked(self):
        account, send = site({MAKE: [Reply(451), Reply(200, {"password": "abcd-efgh-ijkl-mnop"})], RECHECK: [Reply(204)]})
        self.assertEqual(account.make("secret"), "abcd-efgh-ijkl-mnop")
        self.assertEqual([c[1] for c in send.calls], [PASSWORDS_PATH, RECHECK_PATH, PASSWORDS_PATH])
        self.assertEqual(send.calls[1][3], {"password": "secret"})

    def test_a_wrong_recheck_stops(self):
        account, send = site({MAKE: [Reply(451)], RECHECK: [Reply(409)]})
        with self.assertRaises(AppPasswordFailed) as caught:
            account.make("secret")
        self.assertEqual(caught.exception.code, "untrusted")
        self.assertEqual(len(send.calls), 2)

    def test_reasons(self):
        for status, code in ((466, "not_on_the_web"), (400, "no_app_passwords"), (403, "untrusted"), (500, "other")):
            account, _ = site({MAKE: [Reply(status)]})
            with self.assertRaises(AppPasswordFailed) as caught:
                account.make("pw")
            self.assertEqual(caught.exception.code, code)

    def test_an_answer_without_a_password(self):
        account, _ = site({MAKE: [Reply(200, {"id": 5})]})
        with self.assertRaises(AppPasswordFailed):
            account.make("pw")

    def test_reasons_read_well(self):
        import re

        for text in account_site.FAILED.values():
            self.assertIsNone(re.search(DASHES, text))


class FakeDb:
    def __init__(self, rows=None):
        self.rows = {r["id"]: dict(r) for r in (rows or [])}
        self.calls = []

    def _match(self, row, filters):
        for col, cond in filters.items():
            if col in ("select", "order", "limit"):
                continue
            op, _, value = cond.partition(".")
            have = row.get(col)
            if op == "eq" and str(have) != value:
                return False
            if op == "neq" and str(have if have is not None else "") == value:
                return False
            if cond == "not.is.null" and have is None:
                return False
            if op == "in" and str(have) not in value.strip("()").split(","):
                return False
            if op == "lt" and not (have is not None and str(have) < value):
                return False
            if op == "gt" and not (have is not None and str(have) > value):
                return False
        return True

    def first(self, table, params):
        found = self.select(table, params)
        return found[0] if found else None

    def select(self, table, params):
        self.calls.append(("select", params))
        return [dict(r) for r in self.rows.values() if self._match(r, params)]

    def update(self, table, filters, patch, minimal=False):
        self.calls.append(("update", filters, patch))
        hit = [r for r in self.rows.values() if self._match(r, filters)]
        for r in hit:
            r.update(patch)
        return [dict(r) for r in hit]

    def delete(self, table, filters):
        self.calls.append(("delete", filters))
        for rid in [r["id"] for r in self.rows.values() if self._match(r, filters)]:
            del self.rows[rid]


def queued(rid="s1", **extra):
    return {"id": rid, "user_id": "u", "services": ["mail", "calendar"], "sign_in": seal_json({"appleId": "me@icloud.com", "password": "pw"}, KEY), "status": "queued", "created_at": "2026-11-02T10:00:00+00:00", **extra}


class FakeApi:
    """The account sign-in as signin.sign_in drives it."""

    def __init__(self, valid=("123456",), make=None, token="trust"):
        self.valid = list(valid)
        self.requires_2fa = True
        self.requires_2sa = False
        self.is_trusted_session = False
        self.two_factor_delivery_method = "trusted_device"
        self.session = SimpleNamespace(data={"trust_token": token} if token else {})
        self.site = SimpleNamespace(make=make or (lambda password: "abcd-efgh-ijkl-mnop"))

    def authenticate(self):
        pass

    def validate_2fa_code(self, code):
        if code in self.valid:
            self.is_trusted_session = True
            return True
        return False

    def trust_session(self):
        self.is_trusted_session = True


def answer(db, setup_id, code):
    """What the app does with a typed code: seal it onto the row once it is asked for."""

    def typing():
        for _ in range(200):
            row = db.rows.get(setup_id)
            if row and row.get("step") and not row.get("code"):
                row["code"] = seal_json(code, KEY)
                return
            threading.Event().wait(0.005)

    thread = threading.Thread(target=typing, daemon=True)
    thread.start()
    return thread


class Running(unittest.TestCase):
    def test_claims_once(self):
        db = FakeDb([queued()])
        setups = setup.Setups(db, KEY)
        self.assertEqual(setups.claim(AT)["id"], "s1")
        self.assertEqual(db.rows["s1"]["status"], "signing_in")
        self.assertIsNone(setups.claim(AT))

    def test_never_starts_a_sign_in_nobody_is_waiting_on(self):
        db = FakeDb([queued(created_at="2026-11-02T09:58:00+00:00")])
        self.assertIsNone(setup.Setups(db, KEY).claim(AT))
        self.assertEqual(db.rows["s1"]["status"], "queued")

    def test_signs_in_with_a_code_and_hands_back_the_password(self):
        db = FakeDb([queued()])
        setups = setup.Setups(db, KEY)
        row = setups.claim(AT)
        api = FakeApi()
        seen = []
        api.site.make = lambda password: seen.append(password) or "abcd-efgh-ijkl-mnop"
        typing = answer(db, "s1", "123456")
        ended = setup.run_setup(setups, row, threading.Event(), make_api=lambda *a: api, wait_s=2, poll_s=0.01)
        typing.join()
        self.assertEqual(ended, "ready")
        saved = db.rows["s1"]
        self.assertEqual(saved["status"], "ready")
        self.assertEqual(open_json(saved["result"], KEY), {"appPassword": "abcd-efgh-ijkl-mnop", "trustToken": "trust"})
        self.assertEqual(seen, ["pw"])
        self.assertIsNone(saved["step"])
        self.assertEqual(open_json(saved["sign_in"], KEY), {"appleId": "me@icloud.com", "password": ""}, "the Apple ID password goes once the app password is made")

    def test_the_password_stays_for_the_app_only_when_reminders_still_needs_it(self):
        db = FakeDb([queued(services=["mail", "reminders"])])
        setups = setup.Setups(db, KEY)
        setups.claim(AT)
        setups.ready(db.rows["s1"], "abcd-efgh-ijkl-mnop", "trust", {"appleId": "me@icloud.com", "password": "pw"})
        self.assertEqual(open_json(db.rows["s1"]["sign_in"], KEY)["password"], "pw")

    def test_the_code_step_reads_well(self):
        db = FakeDb([queued()])
        codes = setup.SetupCodes(db, "s1", KEY)
        codes.ask("two_factor", "app", 1, "wrong")
        self.assertEqual(db.rows["s1"]["detail"], "Apple did not accept that code. Enter the 6-digit code shown on one of your Apple devices.")
        self.assertEqual(db.rows["s1"]["attempts"], 1)

    def test_no_code_in_time_fails_and_forgets_the_sign_in(self):
        db = FakeDb([queued()])
        setups = setup.Setups(db, KEY)
        row = setups.claim(AT)
        ended = setup.run_setup(setups, row, threading.Event(), make_api=lambda *a: FakeApi(), wait_s=0.05, poll_s=0.01)
        self.assertEqual(ended, "failed")
        self.assertEqual(db.rows["s1"]["status"], "failed")
        self.assertEqual(db.rows["s1"]["sign_in"], "")
        self.assertIn("10 minutes", db.rows["s1"]["error"])

    def test_apple_refusing_the_password_says_why(self):
        def refuse(password):
            raise AppPasswordFailed("not_on_the_web")

        db = FakeDb([queued()])
        setups = setup.Setups(db, KEY)
        row = setups.claim(AT)
        api = FakeApi(make=refuse)
        api.requires_2fa = False
        api.is_trusted_session = True
        self.assertEqual(setup.run_setup(setups, row, threading.Event(), make_api=lambda *a: api), "failed")
        self.assertEqual(db.rows["s1"]["error"], account_site.FAILED["not_on_the_web"])

    def test_an_unreadable_sign_in(self):
        db = FakeDb([queued(sign_in="v1:junk")])
        setups = setup.Setups(db, KEY)
        row = setups.claim(AT)
        self.assertEqual(setup.run_setup(setups, row, threading.Event(), make_api=lambda *a: FakeApi()), "failed")

    def test_sweep_ends_stalled_sign_ins_and_deletes_old_rows(self):
        db = FakeDb([
            queued("old", created_at="2026-11-02T08:00:00+00:00", status="ready"),
            queued("stalled", status="signing_in", claimed_at="2026-11-02T09:00:00+00:00", created_at="2026-11-02T09:59:00+00:00"),
            queued("fresh", created_at="2026-11-02T09:59:00+00:00"),
        ])
        setup.Setups(db, KEY).sweep(datetime(2026, 11, 2, 10, 0, tzinfo=timezone.utc))
        self.assertNotIn("old", db.rows)
        self.assertEqual(db.rows["stalled"]["status"], "failed")
        self.assertEqual(db.rows["fresh"]["status"], "queued")

    def test_sweep_takes_passwords_and_codes_off_rows_older_than_ten_minutes_whatever_their_state(self):
        at = datetime(2026, 11, 2, 10, 0, tzinfo=timezone.utc)
        db = FakeDb([
            queued("waiting", status="ready", result="sealed", created_at="2026-11-02T09:45:00+00:00", updated_at="2026-11-02T09:48:00+00:00"),
            queued("running", status="signing_in", claimed_at="2026-11-02T09:45:00+00:00", created_at="2026-11-02T09:45:00+00:00", code="typed"),
            queued("left", status="queued", created_at="2026-11-02T09:45:00+00:00", code="typed"),
            queued("ended", status="done", created_at="2026-11-02T09:52:00+00:00", updated_at="2026-11-02T09:53:00+00:00"),
            queued("recent", status="ready", result="sealed", created_at="2026-11-02T09:58:00+00:00", updated_at="2026-11-02T09:58:00+00:00"),
        ])
        setup.Setups(db, KEY).sweep(at)
        self.assertEqual((db.rows["waiting"]["status"], db.rows["waiting"]["sign_in"], db.rows["waiting"]["result"]), ("failed", "", None), "a ready row the app never took ends")
        self.assertEqual(db.rows["running"]["sign_in"], "")
        self.assertEqual(db.rows["running"]["code"], "typed", "a running sign-in's code is taken within seconds: left alone")
        self.assertEqual((db.rows["left"]["sign_in"], db.rows["left"]["code"]), ("", None))
        self.assertNotIn("ended", db.rows, "a finished row goes after five minutes")
        self.assertNotEqual(db.rows["recent"]["sign_in"], "")
        self.assertEqual(db.rows["recent"]["result"], "sealed")


class OwnKeyVault:
    """The person's credential keys, as the Vault hands them out: the current one first."""

    def __init__(self, *keys):
        self.keys = list(keys) or [bytes(range(32))]

    def credential_key_for(self, user_id):
        return self.keys[0]

    def credential_keys_for(self, user_id):
        return list(self.keys)


class UnderTheirOwnKey(unittest.TestCase):
    def test_a_sign_in_sealed_under_the_persons_key_is_answered_under_it(self):
        vault = OwnKeyVault()
        row = queued()
        row["sign_in"] = seal_handoff(vault, "u", "icloud_setups", "sign_in", "s1", {"appleId": "me@icloud.com", "password": "pw"})
        db = FakeDb([row])
        setups = setup.Setups(db, "", vault)
        claimed = setups.claim(AT)
        api = FakeApi()
        api.site.make = lambda password: "abcd-efgh-ijkl-mnop"

        def typing():
            for _ in range(200):
                live = db.rows["s1"]
                if live.get("step") and not live.get("code"):
                    live["code"] = seal_handoff(vault, "u", "icloud_setups", "code", "s1", "123456")
                    return
                threading.Event().wait(0.005)

        thread = threading.Thread(target=typing, daemon=True)
        thread.start()
        ended = setup.run_setup(setups, claimed, threading.Event(), make_api=lambda *a: api, wait_s=2, poll_s=0.01)
        thread.join()
        self.assertEqual(ended, "ready")
        saved = db.rows["s1"]
        self.assertTrue(saved["result"].startswith("v2:"))
        self.assertEqual(open_handoff(vault, "", "u", "icloud_setups", "result", "s1", saved["result"]), {"appPassword": "abcd-efgh-ijkl-mnop", "trustToken": "trust"})
        self.assertEqual(open_handoff(vault, "", "u", "icloud_setups", "sign_in", "s1", saved["sign_in"])["password"], "")
        with self.assertRaises(Exception):
            open_handoff(vault, "", "u", "icloud_setups", "sign_in", "s1", saved["result"])  # bound to its column
        with self.assertRaises(Exception):
            open_handoff(vault, "", "u", "icloud_setups", "result", "s2", saved["result"])  # and to its row

    def test_a_row_queued_before_the_release_is_answered_in_the_old_format(self):
        db = FakeDb([queued(services=["mail", "reminders"])])
        setups = setup.Setups(db, KEY, OwnKeyVault())
        row = setups.claim(AT)
        self.assertEqual(setups.sign_in_of(row)["password"], "pw")
        setups.ready(db.rows["s1"], "abcd-efgh-ijkl-mnop", None, setups.sign_in_of(row))
        self.assertEqual(open_json(db.rows["s1"]["result"], KEY)["appPassword"], "abcd-efgh-ijkl-mnop")

    def test_an_old_format_sign_in_is_unreadable_once_the_static_key_is_gone(self):
        db = FakeDb([queued()])
        setups = setup.Setups(db, "", OwnKeyVault())
        row = setups.claim(AT)
        self.assertEqual(setup.run_setup(setups, row, threading.Event(), make_api=lambda *a: FakeApi()), "failed")
        self.assertEqual(db.rows["s1"]["sign_in"], "")

    def test_a_handoff_opens_with_an_older_key_during_a_rotation(self):
        old, new = bytes(range(32)), bytes(range(1, 33))
        sealed = seal_handoff(OwnKeyVault(old), "u", "instagram_sign_ins", "code", "acc", "123456")
        self.assertEqual(open_handoff(OwnKeyVault(new, old), "", "u", "instagram_sign_ins", "code", "acc", sealed), "123456")
        with self.assertRaises(Exception):
            open_handoff(OwnKeyVault(new), "", "u", "instagram_sign_ins", "code", "acc", sealed)


class Explaining(unittest.TestCase):
    def test_says_which_step_apple_refused_and_its_status(self):
        class PyiCloudAPIResponseException(Exception):
            def __init__(self, reason, code):
                super().__init__(reason)
                self.code = code

        class PyiCloudFailedLoginException(Exception):
            pass

        try:
            try:
                raise PyiCloudAPIResponseException("Some Apple text", 401)
            except PyiCloudAPIResponseException as inner:
                raise PyiCloudFailedLoginException("Failed to initiate srp authentication.", inner) from inner
        except PyiCloudFailedLoginException as err:
            found = setup.why(err)
        self.assertEqual(found, {"stage": "init", "error": "PyiCloudFailedLoginException", "status": 401})
        self.assertNotIn("Some Apple text", str(found))


if __name__ == "__main__":
    unittest.main()
