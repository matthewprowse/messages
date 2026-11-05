"""The iCloud Reminders connector on stand-ins for pyicloud: no pyicloud, network or database.

The stand-ins follow pyicloud 2026.10.1: PyiCloudService (authenticate, requires_2fa, validate_2fa_code,
is_trusted_session, reminders and the private SMS and consent helpers) and its RemindersService (sync_cursor,
iter_changes, lists, get, update). Errors are stand-ins named like pyicloud's exceptions."""

import json
import os
import threading
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from ai.connectors.icloud_reminders import backoff, mapping, signin
from ai.connectors.icloud_reminders.run import Accounts, Running, accounts_to_wake
from ai.connectors.icloud_reminders.session import SessionDir, _stem
from ai.connectors.icloud_reminders.store import SignInRow, Store
from ai.connectors.icloud_reminders import sync as sync_module
from ai.connectors.icloud_reminders.sync import REASONS, AccountSync, update_failure
from ai.connectors.instagram.sealing import open_json, seal_json
from ai.fields import TASK_LIST, TASK_NOTES, TASK_TITLE

NOW = datetime(2026, 10, 27, 10, 0, tzinfo=timezone.utc)
KEY = "A" * 43 + "="  # 32 bytes, base64
DASHES = "[" + chr(0x2013) + chr(0x2014) + "]"  # no em or en dashes in app text


# pyicloud's exception classes, by name (pyicloud/exceptions.py, services/reminders/client.py).
class PyiCloudException(Exception):
    pass


class PyiCloudAPIResponseException(PyiCloudException):
    def __init__(self, reason="", code=None):
        super().__init__(reason)
        self.reason = reason
        self.code = code


class PyiCloudConnectionException(PyiCloudAPIResponseException):
    pass


class PyiCloudFailedLoginException(PyiCloudException):
    pass


class PyiCloudAccountLockedException(PyiCloudFailedLoginException):
    pass


class PyiCloudAcceptTermsException(PyiCloudException):
    pass


class PyiCloudServiceNotActivatedException(PyiCloudAPIResponseException):
    pass


class PyiCloudPCSTimeoutException(PyiCloudAPIResponseException):
    pass


class PyiCloudEndpointGoneException(PyiCloudAPIResponseException):
    pass


class RemindersApiError(PyiCloudException):
    def __init__(self, message="", payload=None):
        super().__init__(message)
        self.payload = payload


class RemindersAuthError(PyiCloudException):
    pass


def reminder(rid="Reminder/1", list_id="List/1", **extra):
    fields = dict(
        id=rid, list_id=list_id, title="Call Ana", desc="", completed=False, completed_date=None, due_date=None,
        all_day=False, deleted=False, priority=0, time_zone=None, modified=None, record_change_tag="tag1",
    )
    fields.update(extra)
    return SimpleNamespace(**fields)


def list_(lid="List/1", title="Work", **extra):
    return SimpleNamespace(id=lid, title=title, deleted=extra.get("deleted", False), is_group=extra.get("is_group", False))


class Mapping(unittest.TestCase):
    def test_priority_follows_apples_ranges(self):
        self.assertEqual([mapping.priority(p) for p in (0, 1, 4, 5, 6, 9, 10)], [None, 1, 1, 2, 3, 3, None])

    def test_all_day_is_midnight_utc_of_the_date(self):
        r = reminder(due_date=datetime(2026, 10, 30, tzinfo=timezone.utc), all_day=True)
        self.assertEqual(mapping.due(r), ("2026-10-30T00:00:00Z", True))

    def test_all_day_written_as_a_real_instant_uses_its_zone(self):
        # Local midnight in South Africa is 22:00 the day before in UTC.
        r = reminder(due_date=datetime(2026, 10, 29, 22, tzinfo=timezone.utc), all_day=True, time_zone="Africa/Johannesburg")
        self.assertEqual(mapping.due(r), ("2026-10-30T00:00:00Z", True))

    def test_timed_with_a_zone_is_its_instant(self):
        r = reminder(due_date=datetime(2026, 10, 30, 13, tzinfo=timezone.utc), time_zone="Africa/Johannesburg")
        self.assertEqual(mapping.due(r), ("2026-10-30T13:00:00Z", False))

    def test_floating_time_is_read_in_south_african_time(self):
        r = reminder(due_date=datetime(2026, 10, 30, 13, tzinfo=timezone.utc))
        self.assertEqual(mapping.due(r), ("2026-10-30T11:00:00Z", False))

    def test_no_date(self):
        self.assertEqual(mapping.due(reminder()), (None, True))

    def test_row_in_the_tasks_layers_shape(self):
        r = reminder(title=" Send quote ", desc=" for the roof ", priority=1, due_date=datetime(2026, 10, 28, tzinfo=timezone.utc), all_day=True)
        row = mapping.task_row(r, " Work ", NOW)
        self.assertEqual(
            row,
            {
                "provider_task_id": "Reminder/1", "list_id": "List/1", "list_name": "Work", "title": "Send quote", "notes": "for the roof",
                "due_at": "2026-10-28T00:00:00Z", "due_all_day": True, "status": "open", "completed_at": None, "priority": 1,
                "provider_meta": {"change_tag": "tag1"},
            },
        )
        self.assertNotIn("contact_id", row)  # a contact already matched is kept

    def test_completed_has_its_date_and_open_has_none(self):
        done = reminder(completed=True, completed_date=NOW - timedelta(days=2))
        row = mapping.task_row(done, None, NOW)
        self.assertEqual((row["status"], row["completed_at"], row["list_name"]), ("completed", "2026-10-25T10:00:00Z", None))
        self.assertIsNone(mapping.task_row(reminder(completed_date=NOW), None, NOW)["completed_at"])

    def test_old_completed_and_deleted_are_not_stored(self):
        self.assertIsNone(mapping.task_row(reminder(completed=True, completed_date=NOW - timedelta(days=45)), None, NOW))
        self.assertIsNone(mapping.task_row(reminder(deleted=True), None, NOW))
        self.assertIsNotNone(mapping.task_row(reminder(completed=True, completed_date=None), None, NOW))

    def test_lists_leave_out_groups_and_report_deleted(self):
        names, gone = mapping.wanted_lists([list_(), list_("List/2", "Folder", is_group=True), list_("List/3", "Old", deleted=True)])
        self.assertEqual((names, gone), ({"List/1": "Work"}, {"List/3"}))


class Backoffs(unittest.TestCase):
    def test_kinds_by_pyicloud_class(self):
        cases = [
            (PyiCloudFailedLoginException("No password set"), "expired"),
            (PyiCloudAccountLockedException(), "locked"),
            (RemindersAuthError(), "expired"),
            (PyiCloudAcceptTermsException(), "terms"),
            (PyiCloudServiceNotActivatedException("x"), "not_set_up"),
            (PyiCloudPCSTimeoutException(backoff.PCS_ERROR), "web_access"),
            (PyiCloudAPIResponseException(backoff.PCS_ERROR), "web_access"),
            (PyiCloudConnectionException("x"), "network"),
            (PyiCloudEndpointGoneException("x", 410), "gone"),
            (PyiCloudAPIResponseException("slow down", 429), "rate"),
            (RemindersApiError("x", payload={"retry_after": 30}), "rate"),
            (TimeoutError(), "network"),
            (ValueError(), "other"),
        ]
        for err, kind in cases:
            self.assertEqual(backoff.kind_of(err), kind, type(err).__name__)

    def test_an_ended_session_a_lock_and_a_missing_service_stop_the_account(self):
        for err in (PyiCloudFailedLoginException(), PyiCloudAccountLockedException(), PyiCloudServiceNotActivatedException("x")):
            self.assertTrue(backoff.trouble(err).stop)
        self.assertFalse(backoff.trouble(PyiCloudConnectionException("x")).stop)

    def test_waits_double_with_jitter_and_reset(self):
        b = backoff.Backoff(rand=lambda: 0.5)
        t = backoff.WAITS["network"]
        self.assertEqual([b.next(t), b.next(t), b.next(t)], [60, 120, 240])
        b.reset()
        self.assertEqual(b.next(t), 60)
        self.assertEqual(backoff.Backoff(rand=lambda: 1.0).next(t), 60 * 1.2)
        self.assertEqual(backoff.poll_wait(lambda: 0.5), backoff.POLL_S)


class FakeCodes:
    """signin.Codes over a script of answers: digits, "sms", "continue", or "" for none in time."""

    def __init__(self, answers=()):
        self.answers = list(answers)
        self.asked = []
        self.details = []
        self.finished = False

    def ask(self, step, method, attempt, note=None):
        self.asked.append((step, method, attempt, note))

    def take(self):
        return self.answers.pop(0) if self.answers else None

    def waiting(self, detail):
        self.details.append(detail)

    def done(self):
        self.finished = True


class FakeApi:
    """pyicloud's PyiCloudService as far as signin uses it."""

    def __init__(self, *, valid=("123456",), delivery="trusted_device", phone=True, login_error=None, consent=False, reminders_errors=()):
        self.valid = list(valid)
        self.delivery = delivery
        self.phone = phone
        self.login_error = login_error
        self.consent = consent
        self.reminders_errors = list(reminders_errors)
        self.requires_2fa = True
        self.requires_2sa = False
        self.is_trusted_session = False
        self.texted = 0
        self.checked = []
        self.reminder_calls = 0

    @property
    def two_factor_delivery_method(self):
        return self.delivery

    def authenticate(self):
        if self.login_error:
            raise self.login_error

    def validate_2fa_code(self, code):
        self.checked.append((code, self.delivery))
        if code in self.valid:
            self.is_trusted_session = True
            self.requires_2fa = False
            return True
        return False

    def trust_session(self):
        self.is_trusted_session = True

    def _trusted_phone_number(self):
        return object() if self.phone else None

    def _request_sms_2fa_code(self):
        self.texted += 1
        self.delivery = "sms"

    def _check_pcs_consent(self):
        return {"isICDRSDisabled": self.consent, "isDeviceConsentedForPCS": not self.consent}

    @property
    def reminders(self):
        self.reminder_calls += 1
        if self.reminders_errors:
            raise self.reminders_errors.pop(0)
        self.consent = False
        return "service"


def sign_in(api, codes, stop=None, **wait):
    return signin.sign_in(api, codes, stop or threading.Event(), wait_s=0.2, poll_s=0.0, **wait)


class SignIns(unittest.TestCase):
    def test_a_code_from_an_apple_device(self):
        api, codes = FakeApi(), FakeCodes(["123456"])
        sign_in(api, codes)
        self.assertEqual(codes.asked, [("two_factor", "app", 1, None)])
        self.assertEqual(api.checked, [("123456", "trusted_device")])
        self.assertTrue(api.is_trusted_session)

    def test_send_a_text_instead_texts_a_code_and_checks_it_by_sms(self):
        api, codes = FakeApi(), FakeCodes(["sms", "123456"])
        sign_in(api, codes)
        self.assertEqual(api.texted, 1)
        self.assertEqual(codes.asked, [("two_factor", "app", 1, None), ("two_factor", "sms", 2, None)])
        self.assertEqual(api.checked, [("123456", "sms")])

    def test_no_phone_number_says_so_and_keeps_asking(self):
        api, codes = FakeApi(phone=False), FakeCodes(["sms", "123456"])
        sign_in(api, codes)
        self.assertEqual(api.texted, 0)
        self.assertEqual(codes.asked[1], ("two_factor", "app", 2, "texts"))

    def test_a_wrong_code_asks_again_then_gives_up_after_three(self):
        api, codes = FakeApi(), FakeCodes(["111111", "123456"])
        sign_in(api, codes)
        self.assertEqual(codes.asked[1][3], "wrong")
        with self.assertRaises(signin.SignInFailed) as caught:
            sign_in(FakeApi(), FakeCodes(["1", "2", "3", "4"]))
        self.assertEqual(caught.exception.code, "wrong_code")

    def test_a_text_for_a_phone_that_already_got_one_is_ignored(self):
        api = FakeApi(delivery="sms")
        sign_in(api, FakeCodes(["sms", "123456"]))
        self.assertEqual(api.texted, 0)

    def test_failures_have_plain_reasons(self):
        for err, code in (
            (PyiCloudFailedLoginException("bad"), "bad_password"),
            (PyiCloudAccountLockedException(), "locked"),
            (PyiCloudAcceptTermsException(), "terms"),
            (PyiCloudConnectionException("x"), "network"),
        ):
            codes = FakeCodes()
            with self.assertRaises(signin.SignInFailed) as caught:
                sign_in(FakeApi(login_error=err), codes)
            self.assertEqual(caught.exception.code, code)
            self.assertTrue(codes.finished)
            self.assertNotRegex(caught.exception.detail, DASHES)

    def test_a_security_key_is_not_something_konva_can_use(self):
        with self.assertRaises(signin.SignInFailed) as caught:
            sign_in(FakeApi(delivery="security_key"), FakeCodes(["123456"]))
        self.assertEqual(caught.exception.code, "security_key")

    def test_a_code_not_entered_in_time(self):
        with self.assertRaises(signin.SignInFailed) as caught:
            sign_in(FakeApi(), FakeCodes([]))
        self.assertEqual(caught.exception.code, "timeout")

    def test_stopping_while_waiting(self):
        stop = threading.Event()
        stop.set()
        with self.assertRaises(signin.SignInStopped):
            sign_in(FakeApi(), FakeCodes([]), stop)

    def test_two_step_for_an_older_apple_id(self):
        class TwoStep(FakeApi):
            trusted_devices = [{"deviceName": "Phone", "phoneNumber": "+27"}]

            def __init__(self):
                super().__init__()
                self.requires_2fa, self.requires_2sa, self.sent = False, True, False

            def send_verification_code(self, device):
                self.sent = True
                return True

            def validate_verification_code(self, device, code):
                self.is_trusted_session = code == "654321"
                return self.is_trusted_session

        api = TwoStep()
        sign_in(api, FakeCodes(["654321"]))
        self.assertTrue(api.sent and api.is_trusted_session)


class Access(unittest.TestCase):
    def open(self, api, answers):
        codes = FakeCodes(answers)
        waiter = signin.CodeWait(codes, threading.Event(), wait_s=0.2, poll_s=0.0)
        return codes, signin.open_reminders(api, codes, waiter)

    def test_without_advanced_data_protection_it_just_opens(self):
        api = FakeApi()
        codes, service = self.open(api, [])
        self.assertEqual((service, codes.asked), ("service", []))

    def test_advanced_data_protection_waits_for_the_go_ahead_and_the_approval(self):
        api = FakeApi(consent=True)
        codes, service = self.open(api, ["continue"])
        self.assertEqual(codes.asked, [("code", "app", 1, None)])
        self.assertEqual(service, "service")
        self.assertIn("approve", codes.details[0])

    def test_something_other_than_the_go_ahead_is_not_it(self):
        api = FakeApi(consent=True)
        codes, _ = self.open(api, ["123456", "continue"])
        self.assertEqual(len(codes.asked), 2)

    def test_an_approval_that_did_not_come_is_asked_for_again(self):
        api = FakeApi(consent=True, reminders_errors=[PyiCloudPCSTimeoutException(backoff.PCS_ERROR)])
        codes, service = self.open(api, ["continue", "continue"])
        self.assertEqual([a[3] for a in codes.asked], [None, "again"])
        self.assertEqual((service, api.reminder_calls), ("service", 2))

    def test_web_access_switched_off_is_asked_about_even_when_the_check_could_not_tell(self):
        api = FakeApi(reminders_errors=[PyiCloudAPIResponseException(backoff.PCS_ERROR)])
        codes, service = self.open(api, ["continue"])
        self.assertEqual((codes.asked, service), ([("code", "app", 1, "again")], "service"))

    def test_gives_up_after_three_tries(self):
        api = FakeApi(consent=True, reminders_errors=[PyiCloudPCSTimeoutException(backoff.PCS_ERROR)] * 3)
        with self.assertRaises(signin.SignInFailed) as caught:
            self.open(api, ["continue"] * 3)
        self.assertEqual(caught.exception.code, "web_access")

    def test_a_service_that_is_not_set_up(self):
        api = FakeApi(reminders_errors=[PyiCloudServiceNotActivatedException("x")])
        with self.assertRaises(signin.SignInFailed) as caught:
            self.open(api, [])
        self.assertEqual(caught.exception.code, "not_set_up")


class Sessions(unittest.TestCase):
    def test_files_come_back_out_as_they_went_in_and_are_removed(self):
        saved = {"cookiejar": "#LWP-Cookies-2.0\n", "session": json.dumps({"session_token": "t", "trust_token": "tt"})}
        with SessionDir("Jane.Doe@icloud.com") as d:
            path = d.path
            self.assertEqual(oct(os.stat(path).st_mode & 0o777), "0o700")
            self.assertIsNone(d.dump())
            self.assertTrue(d.restore(saved))
            self.assertEqual(sorted(os.listdir(path)), ["JaneDoeicloudcom.cookiejar", "JaneDoeicloudcom.session"])
            self.assertEqual(d.dump(), saved)
        self.assertFalse(os.path.exists(path))

    def test_whatever_is_open_when_the_process_ends_is_removed(self):
        from ai.connectors.icloud_reminders import session

        d = SessionDir("a@b.com")
        d.restore({"session": "{}"})
        session._close_all()
        self.assertFalse(os.path.exists(d.path))
        d.close()  # closing again is harmless

    def test_nothing_to_restore(self):
        with SessionDir("a@b.com") as d:
            self.assertFalse(d.restore(None))
            self.assertFalse(d.restore({"cookiejar": "x"}))


class FakeDb:
    """Supabase's client as far as the store uses it, recording what it was asked."""

    def __init__(self, first=None, select=None, updated=True):
        self.calls = []
        self._first = first
        self._select = select or []
        self.updated = updated

    def first(self, table, params):
        self.calls.append(("first", table, params))
        return self._first

    def select(self, table, params):
        self.calls.append(("select", table, params))
        return self._select

    def update(self, table, filters, patch, minimal=False):
        self.calls.append(("update", table, filters, patch))
        return [{"id": "x", "updated_at": "2026-10-27T10:00:00Z"}] if self.updated else []

    def upsert(self, table, rows, on_conflict):
        self.calls.append(("upsert", table, rows, on_conflict))

    def delete(self, table, filters):
        self.calls.append(("delete", table, filters))


class FakeVault:
    def seal(self, user_id, field, value, place="", row=None):
        return None if value is None else f"sealed:{field}:{value}"

    def credential_key_for(self, user_id):
        return bytes(range(32))

    def credential_keys_for(self, user_id):
        return [bytes(range(32))]


def real_store(db):
    store = Store(db, FakeVault(), encryption_key=KEY)
    store.creds._owners["acc"] = "u"  # the owner lookup would read the fake db's one canned row
    store.emit = lambda *a, **k: store.events.append((a, k))
    store.events = []
    return store


class Storing(unittest.TestCase):
    def test_tasks_are_sealed_per_field_and_leave_the_contact_alone(self):
        db = FakeDb()
        store = real_store(db)
        row = mapping.task_row(reminder(title="Call Ana", desc="quote"), "Work", NOW)
        self.assertEqual(store.upsert_tasks({"id": "acc", "user_id": "u"}, [row]), 1)
        _, table, rows, conflict = db.calls[0]
        self.assertEqual((table, conflict), ("tasks", "account_id,provider_task_id"))
        stored = rows[0]
        self.assertEqual((stored["title"], stored["notes"], stored["list_name"]), (f"sealed:{TASK_TITLE}:Call Ana", f"sealed:{TASK_NOTES}:quote", f"sealed:{TASK_LIST}:Work"))
        self.assertEqual((stored["user_id"], stored["account_id"]), ("u", "acc"))
        self.assertNotIn("contact_id", stored)

    def test_rows_are_stored_in_batches(self):
        db = FakeDb()
        rows = [mapping.task_row(reminder(rid=f"Reminder/{i}"), None, NOW) for i in range(450)]
        real_store(db).upsert_tasks({"id": "acc", "user_id": "u"}, rows)
        self.assertEqual([len(c[2]) for c in db.calls], [200, 200, 50])

    def test_a_tick_that_went_through_writes_its_task_first_and_settles_done(self):
        db = FakeDb()
        store = real_store(db)
        store.finish_update({"id": "up", "user_id": "u", "task_id": "t", "action": "complete"})
        self.assertEqual([c[1] for c in db.calls], ["tasks", "task_updates"])
        self.assertEqual(db.calls[0][3]["status"], "completed")
        self.assertIsNotNone(db.calls[0][3]["completed_at"])
        self.assertEqual((db.calls[1][2], db.calls[1][3]), ({"id": "eq.up", "status": "eq.updating"}, {"status": "done", "error": None}))
        self.assertEqual(store.events[0][1], {"provider": "icloud_reminders", "action": "complete", "outcome": "done"})

    def test_an_untick_clears_completed_at(self):
        db = FakeDb()
        real_store(db).finish_update({"id": "up", "user_id": "u", "task_id": "t", "action": "reopen"})
        self.assertEqual((db.calls[0][3]["status"], db.calls[0][3]["completed_at"]), ("open", None))

    def test_a_failed_tick_gets_its_reason_and_leaves_its_task(self):
        db = FakeDb()
        store = real_store(db)
        store.finish_update({"id": "up", "user_id": "u", "task_id": "t", "action": "complete"}, "Nope.", "unreachable")
        self.assertEqual([c[1] for c in db.calls], ["task_updates"])
        self.assertEqual(db.calls[0][3], {"status": "failed", "error": "Nope."})
        self.assertEqual(store.events[0][1]["code"], "unreachable")

    def test_a_row_the_worker_already_settled_is_left_alone(self):
        db = FakeDb(updated=False)
        store = real_store(db)
        store.finish_update({"id": "up", "user_id": "u", "task_id": "t", "action": "complete"}, "Nope.")
        self.assertEqual(store.events, [])

    def test_a_delete_removes_its_task_row_before_it_settles(self):
        db = FakeDb()
        real_store(db).finish_update({"id": "up", "user_id": "u", "task_id": "t", "action": "delete"})
        self.assertEqual([c[:2] for c in db.calls], [("delete", "tasks"), ("update", "task_updates")])
        self.assertEqual(db.calls[0][2], {"id": "eq.t", "user_id": "eq.u"})

    def test_a_create_settles_without_a_task_id_and_an_edit_settles_alone(self):
        # task_updates_target_check: a create's row must keep task_id empty, or the database refuses the update.
        db = FakeDb()
        store = real_store(db)
        store.finish_update({"id": "up", "user_id": "u", "task_id": None, "action": "create"})
        store.finish_update({"id": "up2", "user_id": "u", "task_id": "t", "action": "update"})
        self.assertEqual(db.calls[0][3], {"status": "done", "error": None})
        self.assertEqual([c[:2] for c in db.calls], [("update", "task_updates"), ("update", "task_updates")])

    def test_claimed_changes_are_merged_oldest_first_and_text_opens(self):
        rows = [{"id": "b", "created_at": "2"}, {"id": "a", "created_at": "1"}]
        db = FakeDb(select=rows)
        store = real_store(db)
        self.assertEqual([r["id"] for r in store.claimed_updates("acc", "u")], ["a", "b"])
        self.assertEqual(len(db.calls), 3)
        store.vault.open_bound = lambda user, field, value, places, row: None if value is None else f"open:{field}:{places[0]}:{row}:{value}"
        self.assertEqual(store.open_task_text({"id": "up", "user_id": "u", "title": "x", "notes": None}), (f"open:{TASK_TITLE}:task_updates.title:up:x", None))

        def refuse(user, field, value, places, row):
            raise ValueError("sealed_elsewhere")

        store.vault.open_bound = refuse
        self.assertIsNone(store.open_task_text({"id": "up", "user_id": "u", "title": "x", "notes": None}))

    def test_the_password_is_dropped_and_the_session_is_sealed(self):
        db = FakeDb()
        store = real_store(db)
        self.assertEqual(store.forget_password("acc", "a@b.com"), "2026-10-27T10:00:00Z")
        sealed = db.calls[0][3]["ciphertext"]
        self.assertTrue(sealed.startswith("v2:"))  # under the owner's key, not the static one
        self.assertEqual(store.creds.open("acc", sealed), {"kind": "web", "appleId": "a@b.com"})
        store.creds._owners["another-account"] = "u"
        with self.assertRaises(Exception):  # tied to its account
            store.creds.open("another-account", sealed)
        store.save_session("acc", "a@b.com", {"cookiejar": "c", "session": "s"})
        self.assertEqual(store.creds.open("acc", db.calls[1][3]["refreshed"]), {"appleId": "a@b.com", "session": {"cookiejar": "c", "session": "s"}})
        self.assertNotIn("updated_at", db.calls[1][3])  # saving a session never restarts the account

    def test_credentials_open_and_the_kind_tells_web_from_the_relay(self):
        web = FakeDb(first={"ciphertext": real_store(FakeDb()).creds.seal("acc", {"kind": "web", "appleId": "a@b.com", "password": "pw"}), "refreshed": None})
        creds, session = real_store(web).credentials("acc")
        self.assertEqual((creds["appleId"], creds["password"], session), ("a@b.com", "pw", None))
        self.assertEqual(real_store(web).kind("acc"), "web")
        relay = FakeDb(first={"ciphertext": seal_json({"tokenHash": "abc"}, KEY), "refreshed": None})  # an older v1 value still opens
        self.assertIsNone(real_store(relay).kind("acc"))

    def test_the_code_is_taken_once_and_opened(self):
        sealed = seal_json("123456", KEY)
        db = FakeDb(first={"code": sealed})
        row = SignInRow(real_store(db), {"id": "acc", "user_id": "u"})
        self.assertEqual(row.take(), "123456")
        self.assertEqual(db.calls[1][2], {"account_id": "eq.acc", "code": f"eq.{sealed}"})
        self.assertIsNone(SignInRow(real_store(FakeDb(first={"code": None})), {"id": "acc", "user_id": "u"}).take())

    def test_the_step_is_written_with_words_for_the_app(self):
        db = FakeDb()
        row = SignInRow(real_store(db), {"id": "acc", "user_id": "u"})
        row.ask("code", "app", 2, "again")
        upsert = [c for c in db.calls if c[0] == "upsert"][0]
        self.assertEqual((upsert[1], upsert[2]["step"], upsert[2]["method"], upsert[2]["attempts"]), ("instagram_sign_ins", "code", "app", 2))
        detail = [c for c in db.calls if c[0] == "update"][0][3]["status_detail"]
        self.assertTrue(detail.startswith("Apple did not get your approval in time. Turn on Access iCloud Data on the Web"))
        for text in (*SignInRow.ASK.values(), *SignInRow.NOTES.values(), *signin.FAILED.values(), *backoff.STOPS.values().__iter__().__class__.__mro__[:0]):
            self.assertNotRegex(str(text), DASHES)


class FakeReminders:
    """pyicloud's RemindersService as far as sync uses it: a zone with a sync token."""

    def __init__(self, reminders=(), lists=None, token="t1"):
        self.items = {r.id: r for r in reminders}
        self.lists_ = lists if lists is not None else [list_()]
        self.token = token
        self.since = []
        self.updated = []
        self.fail_since = None
        self.tombstones = []
        self.edits = []
        self.created = []
        self.deleted = []

    def sync_cursor(self):
        return self.token

    def lists(self):
        return list(self.lists_)

    def iter_changes(self, since=None):
        self.since.append(since)
        if since is not None and self.fail_since:
            raise self.fail_since
        for r in self.items.values():
            yield SimpleNamespace(type="updated", reminder_id=r.id, reminder=r)
        for rid in self.tombstones:
            yield SimpleNamespace(type="deleted", reminder_id=rid, reminder=None)

    def get(self, rid):
        if rid not in self.items:
            raise LookupError(rid)
        return self.items[rid]

    def update(self, r):
        self.updated.append((r.id, r.completed))
        self.edits.append(r)

    def create(self, list_id, title, desc="", due_date=None, priority=0, all_day=False, time_zone=None):
        r = reminder(f"Reminder/new{len(self.created) + 1}", list_id, title=title, desc=desc, due_date=due_date, priority=priority, all_day=all_day, time_zone=time_zone)
        self.created.append(r)
        self.items[r.id] = r
        return r

    def delete(self, r):
        r.deleted = True
        self.deleted.append(r.id)


class FakeStore:
    def __init__(self, stored=(), updates=()):
        self.stored = set(stored)
        self.state = (None, None)
        self.upserts = []
        self.deleted = []
        self.deleted_lists = []
        self.updates = list(updates)
        self.finished = []
        self.superseded = []
        self.statuses = []
        self.details = []

    def sync_state(self, account_id):
        return self.state

    def save_sync_state(self, account_id, token, full_at):
        self.state = (token, full_at)

    def upsert_tasks(self, account, rows):
        self.upserts.append([r["provider_task_id"] for r in rows])
        self.stored.update(r["provider_task_id"] for r in rows)
        return len(rows)

    def stored_ids(self, account_id):
        return sorted(self.stored)

    def delete_tasks(self, account_id, ids):
        self.deleted.append(sorted(ids))
        self.stored.difference_update(ids)

    def delete_list_tasks(self, account_id, list_ids):
        if list_ids:
            self.deleted_lists.append(list(list_ids))

    def claimed_updates(self, account_id, user_id):
        rows, self.updates = self.updates, []
        return rows

    def open_task_text(self, row):
        return row.get("title") or "", row.get("notes")

    def task_id_of(self, account_id, provider_id):
        return f"task-of-{provider_id}"

    def finish_update(self, row, error=None, code=None):
        self.finished.append((row["id"], error, code))

    def finish_superseded(self, row):
        self.superseded.append(row["id"])

    def set_status(self, account, status, detail=None):
        self.statuses.append((status, detail))

    def set_detail(self, account_id, detail):
        self.details.append(detail)

    def touch(self, account_id):
        pass

    def emit(self, *args, **kwargs):
        pass


class Clock:
    def __init__(self):
        self.t = NOW

    def __call__(self):
        return self.t


class QuickStop(threading.Event):
    """A stop event whose backoff waits (a minute or more) return at once and are recorded; short polls run as usual."""

    def __init__(self):
        super().__init__()
        self.waits = []

    def wait(self, timeout=None):
        if timeout is not None and timeout >= 30:
            self.waits.append(timeout)
            return self.is_set()
        return super().wait(timeout)


def account_sync(store, clock=None, **kw):
    clock = clock or Clock()
    return AccountSync(store, {"id": "acc", "user_id": "u"}, threading.Event(), now=clock, **kw)


def tick_row(rid="up1", action="complete", task="Reminder/1", account="acc"):
    return {"id": rid, "user_id": "u", "action": action, "task_id": "task-1", "tasks": {"provider_task_id": task, "account_id": account}}


class Syncing(unittest.TestCase):
    def test_the_first_sync_reads_everything_and_saves_the_token(self):
        store = FakeStore()
        service = FakeReminders([reminder("Reminder/1"), reminder("Reminder/2")], token="t1")
        sync = account_sync(store)
        sync.sync(service)
        self.assertEqual(service.since, [None])
        self.assertEqual(store.upserts, [["Reminder/1", "Reminder/2"]])
        self.assertEqual(store.state[0], "t1")
        self.assertIsNotNone(store.state[1])

    def test_a_full_read_removes_what_is_gone_from_icloud(self):
        store = FakeStore(stored=["Reminder/1", "Reminder/9"])
        account_sync(store).sync(FakeReminders([reminder("Reminder/1")]))
        self.assertEqual(store.deleted, [["Reminder/9"]])

    def test_an_empty_zone_with_no_lists_is_not_taken_as_everything_deleted(self):
        store = FakeStore(stored=["Reminder/1"])
        account_sync(store).sync(FakeReminders([], lists=[]))
        self.assertEqual(store.deleted, [])

    def test_later_syncs_read_only_the_changes_since_the_token(self):
        store = FakeStore()
        sync = account_sync(store)
        service = FakeReminders([reminder("Reminder/1")], token="t1")
        sync.sync(service)
        service.token = "t2"
        service.items = {"Reminder/1": reminder("Reminder/1", title="Call Ana now")}
        service.since.clear()
        sync.sync(service)
        self.assertEqual(service.since, ["t1"])
        self.assertEqual(store.state[0], "t2")
        self.assertEqual(store.upserts[-1], ["Reminder/1"])
        self.assertEqual(store.deleted, [])  # a delta never decides something is gone by its absence

    def test_unchanged_reminders_are_not_written_again(self):
        store = FakeStore()
        sync = account_sync(store)
        service = FakeReminders([reminder("Reminder/1")])
        sync.sync(service)
        clock_forward = sync.now
        clock_forward.t += timedelta(hours=7)  # a full read is due
        sync.sync(service)
        self.assertEqual(len(store.upserts), 1)

    def test_deleted_reminders_and_tombstones_are_removed(self):
        store = FakeStore(stored=["Reminder/1", "Reminder/2", "Reminder/3"])
        sync = account_sync(store)
        service = FakeReminders([reminder("Reminder/1")])
        sync.sync(service)
        store.deleted.clear()
        service.items = {"Reminder/2": reminder("Reminder/2", deleted=True)}
        service.tombstones = ["Reminder/3"]
        sync.sync(service)
        self.assertEqual(store.deleted, [["Reminder/2", "Reminder/3"]])

    def test_reminders_of_a_deleted_list_go_with_it(self):
        store = FakeStore()
        service = FakeReminders([reminder("Reminder/1", list_id="List/gone"), reminder("Reminder/2")], lists=[list_(), list_("List/gone", "Old", deleted=True)])
        account_sync(store).sync(service)
        self.assertEqual(store.upserts, [["Reminder/2"]])
        self.assertEqual(store.deleted_lists, [["List/gone"]])

    def test_a_renamed_list_is_read_in_full_again(self):
        store = FakeStore()
        sync = account_sync(store)
        service = FakeReminders([reminder("Reminder/1")])
        sync.sync(service)
        service.since.clear()
        service.lists_ = [list_(title="Clients")]
        sync.sync(service)
        self.assertEqual(service.since, [None])
        self.assertEqual(store.upserts[-1], ["Reminder/1"])

    def test_a_token_apple_no_longer_accepts_falls_back_to_a_full_read(self):
        store = FakeStore()
        sync = account_sync(store)
        service = FakeReminders([reminder("Reminder/1")])
        sync.sync(service)
        service.since.clear()
        service.fail_since = RemindersApiError("BAD_SYNC_TOKEN")
        sync.sync(service)
        self.assertEqual(service.since, ["t1", None])

    def test_a_network_error_is_not_mistaken_for_a_bad_token(self):
        store = FakeStore()
        sync = account_sync(store)
        service = FakeReminders([reminder("Reminder/1")])
        sync.sync(service)
        service.fail_since = PyiCloudConnectionException("x")
        with self.assertRaises(PyiCloudConnectionException):
            sync.sync(service)

    def test_the_token_is_kept_when_storing_fails(self):
        class Failing(FakeStore):
            def upsert_tasks(self, account, rows):
                raise RuntimeError("db")

        store = Failing()
        with self.assertRaises(RuntimeError):
            account_sync(store).sync(FakeReminders([reminder("Reminder/1")]))
        self.assertEqual(store.state, (None, None))


class Ticking(unittest.TestCase):
    def tick(self, row, reminders, store=None):
        store = store or FakeStore(updates=[row])
        sync = account_sync(store)
        sync.apply_updates(reminders)
        return store

    def test_a_tick_completes_the_reminder_in_icloud_and_settles_done(self):
        service = FakeReminders([reminder("Reminder/1")])
        store = self.tick(tick_row(), service)
        self.assertEqual(service.updated, [("Reminder/1", True)])
        self.assertEqual(store.finished, [("up1", None, None)])

    def test_an_untick_reopens_it(self):
        service = FakeReminders([reminder("Reminder/1", completed=True, completed_date=NOW)])
        store = self.tick(tick_row(action="reopen"), service)
        self.assertEqual(service.updated, [("Reminder/1", False)])
        self.assertEqual(store.finished, [("up1", None, None)])

    def test_one_already_as_asked_counts_as_done_without_a_write(self):
        service = FakeReminders([reminder("Reminder/1", completed=True)])
        store = self.tick(tick_row(), service)
        self.assertEqual((service.updated, store.finished), ([], [("up1", None, None)]))

    def test_a_reminder_deleted_in_icloud_fails_with_its_reason_and_the_rest_go_on(self):
        service = FakeReminders([reminder("Reminder/2")])
        store = FakeStore(updates=[tick_row("up1", task="Reminder/1"), tick_row("up2", task="Reminder/2")])
        account_sync(store).apply_updates(service)
        self.assertEqual(store.finished, [("up1", REASONS["gone"], "provider_refused"), ("up2", None, None)])

    def test_other_accounts_and_unknown_actions_are_not_touched(self):
        service = FakeReminders([reminder("Reminder/1")])
        store = self.tick(tick_row(account="other"), service, FakeStore(updates=[tick_row(account="other"), tick_row("up3", action="archive")]))
        self.assertEqual((service.updated, store.finished), ([], []))

    def test_an_unreachable_icloud_fails_the_tick_and_raises_for_the_loop(self):
        class Offline(FakeReminders):
            def get(self, rid):
                raise PyiCloudConnectionException("x")

        store = FakeStore(updates=[tick_row()])
        with self.assertRaises(PyiCloudConnectionException):
            account_sync(store).apply_updates(Offline([reminder()]))
        self.assertEqual(store.finished, [("up1", REASONS["network"], "unreachable")])

    def test_failure_reasons(self):
        self.assertEqual(update_failure(LookupError("x"))[0], REASONS["gone"])
        self.assertEqual(update_failure(PyiCloudFailedLoginException())[1], "account_needs_attention")
        self.assertEqual(update_failure(ValueError())[0], REASONS["refused"])
        for reason in REASONS.values():
            self.assertNotRegex(reason, DASHES)


def change_row(action, rid="up1", task="Reminder/1", account="acc", **fields):
    """A claimed create, update or delete. A create has no task, only an account."""
    row = {"id": rid, "user_id": "u", "action": action, "title": None, "notes": None, "due_at": None, "due_all_day": False, "priority": None}
    if action == "create":
        row.update(task_id=None, account_id=account, tasks=None)
    else:
        row.update(task_id="task-1" if task else None, account_id=None, tasks={"provider_task_id": task, "account_id": account} if task else None)
    row.update(fields)
    return row


class Editing(unittest.TestCase):
    def run_rows(self, rows, service):
        store = FakeStore(updates=rows)
        account_sync(store).apply_updates(service)
        return store

    def test_a_new_task_goes_in_the_reminders_list_and_is_stored_like_a_synced_one(self):
        service = FakeReminders(lists=[list_("List/1", "Work"), list_("List/2", "Reminders")])
        row = change_row("create", title="Pay rent", notes="Landlord", due_at="2026-10-30T00:00:00+00:00", due_all_day=True, priority=1)
        store = self.run_rows([row], service)
        made = service.created[0]
        self.assertEqual((made.list_id, made.title, made.desc, made.priority, made.all_day, made.time_zone), ("List/2", "Pay rent", "Landlord", 1, True, None))
        self.assertEqual(made.due_date, datetime(2026, 10, 30, tzinfo=timezone.utc))
        self.assertEqual(store.upserts, [["Reminder/new1"]])
        self.assertEqual(store.finished, [("up1", None, None)], "settled without a task id, which the database refuses on a create")

    def test_a_new_task_without_a_reminders_list_goes_in_the_first_and_a_timed_due_is_an_instant(self):
        service = FakeReminders(lists=[list_("List/1", "Work")])
        store = self.run_rows([change_row("create", title="Call", due_at="2026-10-30T08:30:00Z", priority=3)], service)
        made = service.created[0]
        self.assertEqual((made.list_id, made.priority, made.all_day, made.time_zone), ("List/1", 9, False, "UTC"))
        self.assertEqual(made.due_date, datetime(2026, 10, 30, 8, 30, tzinfo=timezone.utc))
        self.assertEqual(store.finished, [("up1", None, None)])

    def test_a_new_task_needs_a_title_and_a_list(self):
        store = self.run_rows([change_row("create", title="  ")], FakeReminders())
        self.assertEqual(store.finished, [("up1", REASONS["no_title"], "invalid_input")])
        service = FakeReminders(lists=[])
        store = self.run_rows([change_row("create", title="x")], service)
        self.assertEqual((store.finished, service.created), ([("up1", REASONS["no_list"], "invalid_input")], []))

    def test_an_edit_sets_the_whole_wanted_state_and_clears_what_is_null(self):
        old = reminder("Reminder/1", title="Old", desc="old notes", priority=5, due_date=NOW, record_change_tag="t")
        service = FakeReminders([old])
        store = self.run_rows([change_row("update", title="New", notes=None, due_at=None, priority=3)], service)
        self.assertEqual((old.title, old.desc, old.due_date, old.all_day, old.time_zone, old.priority), ("New", "", None, False, None, 9))
        self.assertEqual((len(service.edits), store.upserts, store.finished), (1, [["Reminder/1"]], [("up1", None, None)]))

    def test_a_priority_already_in_the_wanted_band_is_left_as_apple_has_it(self):
        old = reminder("Reminder/1", priority=3)
        service = FakeReminders([old])
        self.run_rows([change_row("update", title="Call Ana", priority=1)], service)
        self.assertEqual(old.priority, 3)

    def test_editing_a_reminder_gone_from_icloud_fails_with_its_reason(self):
        store = self.run_rows([change_row("update", title="x")], FakeReminders())
        self.assertEqual(store.finished, [("up1", REASONS["deleted"], "provider_refused")])
        store = self.run_rows([change_row("update", title="x", task=None)], FakeReminders())
        self.assertEqual(store.finished, [("up1", REASONS["deleted"], "provider_refused")])
        gone = reminder("Reminder/1", deleted=True)
        store = self.run_rows([change_row("update", title="x")], FakeReminders([gone]))
        self.assertEqual(store.finished, [("up1", REASONS["deleted"], "provider_refused")])

    def test_a_delete_deletes_in_icloud_and_one_already_gone_counts_as_done(self):
        service = FakeReminders([reminder("Reminder/1")])
        store = self.run_rows([change_row("delete")], service)
        self.assertEqual((service.deleted, store.finished), (["Reminder/1"], [("up1", None, None)]))
        for row in (change_row("delete", task=None), change_row("delete", task="Reminder/9")):
            service = FakeReminders()
            store = self.run_rows([row], service)
            self.assertEqual((service.deleted, store.finished), ([], [("up1", None, None)]))

    def test_a_delete_wins_over_edits_and_ticks_queued_before_it_in_order(self):
        service = FakeReminders([reminder("Reminder/1"), reminder("Reminder/2")])
        rows = [
            change_row("update", "up1", title="x"),
            tick_row("up2"),
            change_row("update", "up3", task="Reminder/2", title="y"),
            change_row("delete", "up4"),
            change_row("update", "up5", title="after"),
        ]
        rows[2]["task_id"] = "task-2"
        store = self.run_rows(rows, service)
        self.assertEqual(store.superseded, ["up1", "up2"])
        self.assertEqual(service.deleted, ["Reminder/1"])
        self.assertEqual([f[0] for f in store.finished], ["up3", "up4", "up5"])
        self.assertEqual(store.finished[2][1], REASONS["deleted"])

    def test_other_accounts_and_other_users_are_not_touched(self):
        service = FakeReminders([reminder("Reminder/1")])
        foreign = change_row("create", "up2", title="x")
        foreign["user_id"] = "someone"
        store = self.run_rows([change_row("create", "up1", title="x", account="other"), change_row("update", title="x", account="other"), change_row("delete", "up3", account="other"), foreign], service)
        self.assertEqual((service.created, service.edits, service.deleted, store.finished, store.superseded), ([], [], [], [], []))

    def test_an_unreachable_icloud_fails_the_edit_and_raises_for_the_loop(self):
        class Offline(FakeReminders):
            def create(self, *a, **k):
                raise PyiCloudConnectionException("x")

        store = FakeStore(updates=[change_row("create", title="x")])
        with self.assertRaises(PyiCloudConnectionException):
            account_sync(store).apply_updates(Offline())
        self.assertEqual(store.finished, [("up1", REASONS["network"], "unreachable")])

    def test_reasons_have_no_dashes(self):
        for reason in REASONS.values():
            self.assertNotRegex(reason, DASHES)


class Connecting(unittest.TestCase):
    def sync(self, creds, saved=None, api=None, store=None):
        store = store or FakeStore()
        store.credentials = lambda account_id: (creds, saved)
        store.saved = []
        store.save_session = lambda account_id, apple_id, session: store.saved.append((apple_id, session))
        store.forget_password = lambda account_id, apple_id: store.__dict__.setdefault("forgot", apple_id) and "2026-10-27T11:00:00Z"
        store.signed_in = lambda account: store.__dict__.setdefault("signed", True)
        store.db = FakeDb()
        moved = []
        made = []

        def make_api(apple_id, password, directory):
            made.append((apple_id, password))
            with open(os.path.join(directory, f"{_stem(apple_id)}.session"), "w") as out:  # pyicloud writes its files as it goes
                out.write("{}")
            return api

        sync = account_sync(store, make_api=make_api, on_credentials=moved.append)
        return sync, store, moved, made

    def test_a_password_signs_in_saves_the_session_and_drops_the_password(self):
        api = FakeApi(valid=["123456"])
        sync, store, moved, made = self.sync({"kind": "web", "appleId": "a@b.com", "password": "pw"}, api=api)
        store.db = FakeDb(first={"code": seal_json("123456", KEY)})  # the code the person typed in the app
        store.encryption_key = KEY
        ready = sync.connect()
        self.assertEqual(made, [("a@b.com", "pw")])
        self.assertEqual(ready, (api, "service"))
        self.assertEqual(store.__dict__["forgot"], "a@b.com")
        self.assertEqual(moved, ["2026-10-27T11:00:00Z"])
        self.assertTrue(store.__dict__["signed"])
        self.assertEqual(store.saved[0][0], "a@b.com")
        self.assertEqual(store.statuses[0], ("connecting", "Signing in to iCloud."))
        sync.dir.close()

    def test_a_refused_password_is_a_plain_error_and_nothing_is_saved(self):
        api = FakeApi(login_error=PyiCloudFailedLoginException("bad"))
        sync, store, moved, _ = self.sync({"kind": "web", "appleId": "a@b.com", "password": "pw"}, api=api)
        self.assertIsNone(sync.connect())
        self.assertEqual(store.statuses[-1], ("error", signin.FAILED["bad_password"]))
        self.assertEqual((store.saved, moved), ([], []))
        sync.dir.close()

    def test_an_unreachable_icloud_is_tried_again_before_asking(self):
        api = FakeApi(valid=["123456"])
        failures = [PyiCloudConnectionException("Request failed to iCloud"), PyiCloudConnectionException("Request failed to iCloud")]
        api.authenticate = lambda: failures and (_ for _ in ()).throw(failures.pop(0))
        sync, store, _, made = self.sync({"kind": "web", "appleId": "a@b.com", "password": "pw"}, api=api)
        store.db = FakeDb(first={"code": seal_json("123456", KEY)})
        store.encryption_key = KEY
        sync.stop = QuickStop()
        self.assertEqual(sync.connect(), (api, "service"))
        self.assertEqual(len(made), 3, "a fresh client for each try")
        self.assertEqual(len(sync.stop.waits), 2)
        self.assertNotIn("error", [status for status, _ in store.statuses])
        self.assertEqual(sync.backoff.failures, 0)
        sync.dir.close()

    def test_icloud_never_answering_gives_up_after_a_few_tries(self):
        api = FakeApi(login_error=PyiCloudConnectionException("Request failed to iCloud"))
        sync, store, _, made = self.sync({"kind": "web", "appleId": "a@b.com", "password": "pw"}, api=api)
        sync.stop = QuickStop()
        self.assertIsNone(sync.connect())
        self.assertEqual(len(made), sync_module.UNREACHABLE_TRIES)
        self.assertEqual(store.statuses[-1], ("error", signin.FAILED["network"]))
        sync.dir.close()

    def test_a_refused_password_is_not_tried_again(self):
        api = FakeApi(login_error=PyiCloudFailedLoginException("bad"))
        sync, store, _, made = self.sync({"kind": "web", "appleId": "a@b.com", "password": "pw"}, api=api)
        sync.stop = QuickStop()
        self.assertIsNone(sync.connect())
        self.assertEqual((len(made), sync.stop.waits), (1, []))
        sync.dir.close()

    def test_a_saved_session_is_picked_up_with_no_password(self):
        api = FakeApi()
        api.requires_2fa, api.is_trusted_session = False, True
        saved = {"appleId": "A@b.com", "session": {"cookiejar": "c", "session": "{}"}}
        sync, store, _, made = self.sync({"kind": "web", "appleId": "a@b.com"}, saved, api)
        self.assertEqual(sync.connect(), (api, "service"))
        self.assertEqual(made, [("a@b.com", None)])
        self.assertEqual(store.statuses, [])
        sync.dir.close()

    def test_a_session_apple_has_ended_asks_for_a_new_sign_in(self):
        api = FakeApi(login_error=PyiCloudFailedLoginException("No password set"))
        saved = {"appleId": "a@b.com", "session": {"cookiejar": "c", "session": "{}"}}
        sync, store, _, _ = self.sync({"kind": "web", "appleId": "a@b.com"}, saved, api)
        self.assertIsNone(sync.connect())
        self.assertEqual(store.statuses[-1], ("error", backoff.STOPS["expired"].detail))
        sync.dir.close()

    def test_an_untrusted_session_counts_as_ended(self):
        api = FakeApi()  # still wants two-factor
        saved = {"appleId": "a@b.com", "session": {"cookiejar": "c", "session": "{}"}}
        sync, store, _, _ = self.sync({"kind": "web", "appleId": "a@b.com"}, saved, api)
        self.assertIsNone(sync.connect())
        self.assertEqual(store.statuses[-1][0], "error")
        sync.dir.close()

    def test_a_session_for_another_apple_id_is_not_used(self):
        sync, store, _, made = self.sync({"kind": "web", "appleId": "a@b.com"}, {"appleId": "other@b.com", "session": {"session": "{}"}}, FakeApi())
        self.assertIsNone(sync.connect())
        self.assertEqual(store.statuses[-1], ("error", "Connect iCloud Reminders again in Settings."))
        sync.dir.close()

    def test_the_mac_relays_credentials_are_not_this_connectors(self):
        sync, store, _, made = self.sync({"tokenHash": "abc"}, None, FakeApi())
        self.assertIsNone(sync.connect())
        self.assertEqual(made, [])


class Reconciling(unittest.TestCase):
    def test_only_web_sign_ins_are_run_and_each_is_read_once(self):
        reads = []

        class Kinds:
            def kind(self, account_id):
                reads.append(account_id)
                return "web" if account_id == "web" else None

        accounts = Accounts(Kinds())
        self.assertTrue(accounts.is_web("web", "t1"))
        self.assertTrue(accounts.is_web("web", "t1"))
        self.assertFalse(accounts.is_web("relay", "t1"))
        self.assertFalse(accounts.is_web("relay", "t1"))
        self.assertEqual(reads, ["web", "relay"])
        accounts.is_web("web", "t2")  # a new sign-in is looked at again
        self.assertEqual(reads, ["web", "relay", "web"])


if __name__ == "__main__":
    unittest.main()


class LoopWait(unittest.TestCase):
    def test_idle_account_looks_less_often_and_snaps_back(self):
        from ai.connectors.icloud_reminders.sync import IDLE_AFTER, LOOP_S, MID_S, SLOW_S, loop_wait

        self.assertEqual(loop_wait(0), LOOP_S)
        self.assertEqual(loop_wait(IDLE_AFTER - 1), LOOP_S)
        self.assertEqual(loop_wait(IDLE_AFTER), MID_S)
        self.assertEqual(loop_wait(2 * IDLE_AFTER), SLOW_S)
        self.assertEqual(loop_wait(1000), SLOW_S)
        self.assertEqual(loop_wait(0), LOOP_S)  # a claimed row sets the count back to 0


class Waking(unittest.TestCase):
    """A change the sync worker claims wakes its account at once, instead of waiting up to 30 seconds."""

    RUNNING = {"acc1": "u1", "acc2": "u1", "acc3": "u2"}

    def test_a_new_task_wakes_its_account(self):
        self.assertEqual(accounts_to_wake([{"account_id": "acc3", "user_id": "u2", "tasks": None}], self.RUNNING), {"acc3"})

    def test_a_change_to_a_task_wakes_the_task_account(self):
        self.assertEqual(accounts_to_wake([{"account_id": None, "user_id": "u1", "tasks": {"account_id": "acc2"}}], self.RUNNING), {"acc2"})

    def test_a_change_whose_task_is_gone_wakes_every_account_of_its_user(self):
        self.assertEqual(accounts_to_wake([{"account_id": None, "user_id": "u1", "tasks": None}], self.RUNNING), {"acc1", "acc2"})

    def test_another_provider_s_change_wakes_nothing(self):
        self.assertEqual(accounts_to_wake([{"account_id": "google-tasks", "user_id": "u1", "tasks": None}], self.RUNNING), set())
        self.assertEqual(accounts_to_wake([{"account_id": None, "user_id": "u1", "tasks": {"account_id": "todo"}}], self.RUNNING), set())

    def test_the_runner_sets_the_wake_of_the_account_with_a_claimed_change(self):
        accounts = Accounts(SimpleNamespace(claimed_targets=lambda: [{"account_id": "acc1", "user_id": "u1", "tasks": None}]))
        woken, idle = threading.Event(), threading.Event()
        accounts.running = {
            "acc1": Running(threading.Thread(), threading.Event(), "t", user_id="u1", wake=woken),
            "acc2": Running(threading.Thread(), threading.Event(), "t", user_id="u1", wake=idle),
        }
        accounts.wake_claimed()
        self.assertTrue(woken.is_set())
        self.assertFalse(idle.is_set())

    def test_stopping_an_account_wakes_it_so_it_stops_at_once(self):
        accounts = Accounts(SimpleNamespace())
        stop, wake = threading.Event(), threading.Event()
        accounts.running = {"acc1": Running(threading.Thread(), stop, "t", user_id="u1", wake=wake)}
        accounts.halt("acc1")
        self.assertTrue(stop.is_set() and wake.is_set())
