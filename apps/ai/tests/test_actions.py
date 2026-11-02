"""Tests for ai.actions: what a proposed next step must pass before it is stored (only listed files and templates, real
dates, plain titles), that the draft schema stays valid without one, and that storing never raises and seals the arguments."""

import json
import unittest
from datetime import date, datetime, timezone

from ai import actions
from ai.actions import Offer, validate, with_action
from ai.drafts_prompt import SCHEMA

TODAY = date(2026, 11, 2)
OFFER = Offer(files=[{"id": "f1", "name": "Proposal.pdf"}, {"id": "f2", "name": "Rates.xlsx"}], templates=[{"id": "t1", "title": "Pricing Reply"}])


class FakeVault:
    def seal(self, user, field, value):
        return f"sealed:{field}:{value}"

    def open(self, user, field, value):
        return value


class FakeDb:
    def __init__(self, fail=False, files=None, templates=None):
        self.fail, self.inserted, self.files, self.templates = fail, [], files or [], templates or []

    def insert(self, table, row):
        if self.fail:
            raise RuntimeError("down")
        self.inserted.append((table, row))
        return [row]

    def select(self, table, params):
        if self.fail:
            raise RuntimeError("down")
        return self.files if table == "attachments" else self.templates


class Validate(unittest.TestCase):
    def test_a_meeting_keeps_a_plain_title_and_a_known_length(self):
        got = validate({"kind": "book_meeting", "title": "  Catch up — pricing  ", "minutes": 30}, OFFER, TODAY)
        self.assertEqual(got, {"kind": "book_meeting", "args": {"title": "Catch up, pricing", "minutes": 30}})
        self.assertEqual(validate({"kind": "book_meeting", "title": "Call", "minutes": 7}, OFFER, TODAY)["args"]["minutes"], 60)
        self.assertIsNone(validate({"kind": "book_meeting", "title": "   "}, OFFER, TODAY))

    def test_a_task_due_date_must_be_real_and_not_past_or_far_off(self):
        task = lambda due: validate({"kind": "create_task", "title": "Send quote", "due": due}, OFFER, TODAY)["args"]["due"]
        self.assertEqual(task("2026-11-05"), "2026-11-05")
        self.assertEqual(task("2026-11-02"), "2026-11-02")
        for bad in ("2026-11-01", "2031-01-01", "2026-02-30", "next week", "", None, 5):
            self.assertIsNone(task(bad), bad)

    def test_a_file_must_be_one_of_the_listed_numbers(self):
        self.assertEqual(validate({"kind": "attach_file", "file": 2}, OFFER, TODAY)["args"], {"attachment_id": "f2", "name": "Rates.xlsx"})
        for bad in (0, 3, -1, "1", 1.0, True, None):
            self.assertIsNone(validate({"kind": "attach_file", "file": bad}, OFFER, TODAY), bad)
        self.assertIsNone(validate({"kind": "attach_file", "file": 1}, Offer(), TODAY))

    def test_a_template_must_be_one_of_the_listed_numbers(self):
        self.assertEqual(validate({"kind": "use_template", "template": 1}, OFFER, TODAY)["args"], {"template_id": "t1", "title": "Pricing Reply"})
        self.assertIsNone(validate({"kind": "use_template", "template": 2}, OFFER, TODAY))

    def test_unknown_kinds_and_shapes_are_dropped(self):
        for bad in (None, "book_meeting", [], {"kind": "send_email", "title": "x"}, {"title": "x"}, {"kind": 5}):
            self.assertIsNone(validate(bad, OFFER, TODAY))


class Schema(unittest.TestCase):
    def test_the_action_is_optional_and_the_body_still_required(self):
        got = with_action(SCHEMA)
        self.assertEqual(got["required"], ["body"])
        self.assertIn("action", got["properties"])
        self.assertNotIn("action", SCHEMA["properties"])  # the original is not changed

    def test_the_prompt_lists_are_numbered_and_fenced(self):
        text = OFFER.block("UNTRUSTED-abc")
        self.assertIn("<<<UNTRUSTED-abc\n1. Proposal.pdf\nUNTRUSTED-abc>>>", text)
        self.assertIn("2. Rates.xlsx", text)
        self.assertIn("1. Pricing Reply", text)
        self.assertIn("(none)", Offer().block("UNTRUSTED-abc"))


class Store(unittest.TestCase):
    NOW = datetime(2026, 11, 2, 9, 0, tzinfo=timezone.utc)

    def test_a_valid_action_is_stored_with_sealed_arguments(self):
        db = FakeDb()
        self.assertTrue(actions.propose(db, FakeVault(), "u1", "th1", "d1", {"kind": "create_task", "title": "Send quote", "due": "2026-11-04"}, OFFER, self.NOW))
        table, row = db.inserted[0]
        self.assertEqual((table, row["user_id"], row["thread_id"], row["draft_id"], row["kind"]), ("actions", "u1", "th1", "d1", "create_task"))
        self.assertTrue(row["args"].startswith("sealed:action:"))
        self.assertEqual(json.loads(row["args"].split(":", 2)[2]), {"title": "Send quote", "due": "2026-11-04"})

    def test_nothing_is_stored_for_an_invalid_action_or_a_failing_database(self):
        db = FakeDb()
        self.assertFalse(actions.propose(db, FakeVault(), "u1", "th1", "d1", {"kind": "attach_file", "file": 9}, OFFER, self.NOW))
        self.assertFalse(actions.propose(db, FakeVault(), "u1", "th1", "d1", None, OFFER, self.NOW))
        self.assertEqual(db.inserted, [])
        self.assertFalse(actions.propose(FakeDb(fail=True), FakeVault(), "u1", "th1", "d1", {"kind": "book_meeting", "title": "Call"}, OFFER, self.NOW))

    def test_gather_lists_this_conversations_files_and_the_users_templates(self):
        db = FakeDb(files=[{"id": "f1", "filename": "Quote.pdf"}, {"id": "f2", "filename": ""}], templates=[{"id": "t1", "title": "Intro"}, {"id": "t2", "title": ""}])
        got = actions.gather(db, FakeVault(), "u1", "th1")
        self.assertEqual(got.files, [{"id": "f1", "name": "Quote.pdf"}])
        self.assertEqual(got.templates, [{"id": "t1", "title": "Intro"}])

    def test_gather_survives_a_failing_database(self):
        got = actions.gather(FakeDb(fail=True), FakeVault(), "u1", "th1")
        self.assertEqual((got.files, got.templates), ([], []))


if __name__ == "__main__":
    unittest.main()
