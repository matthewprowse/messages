"""Tests for ai.commitments and its use in the follow-up check (ai.chasers): the promises the model lists are cleaned, sealed
and stored from the same call as the Waiting check, and a missed promise of theirs brings its conversation back as a reminder."""

import unittest
from datetime import date, datetime, timedelta, timezone

from ai.chasers import SCHEMA, SYSTEM, Chasers, build_prompt
from ai.commitments import clean_commitments, commitment_rows, due_nudges, nudge_time, parse_due, sweep
from tests.test_fixes import ChaserDb

TODAY = date(2026, 11, 2)  # a Monday
NOW = datetime(2026, 11, 6, 8, 0, tzinfo=timezone.utc)


class Plain:
    """A vault that seals nothing, recording the field it was asked for."""

    def __init__(self):
        self.fields = []

    def seal(self, user, field, value):
        self.fields.append(field)
        return value

    def open_row(self, user, row, columns):
        pass


class Cleaning(unittest.TestCase):
    def test_a_day_is_kept_only_when_it_is_a_real_nearby_date(self):
        self.assertEqual(parse_due("2026-11-06", TODAY), date(2026, 11, 6))
        self.assertIsNone(parse_due("", TODAY))
        self.assertIsNone(parse_due("Friday", TODAY))
        self.assertIsNone(parse_due("2019-01-01", TODAY))
        self.assertIsNone(parse_due("2031-01-01", TODAY))

    def test_unknown_owners_empty_text_and_repeats_are_dropped_and_text_is_one_short_line(self):
        raw = [
            {"text": "Send the\nquote  ", "owner": "me", "due": "2026-11-06", "said_in": "last"},
            {"text": "send the quote", "owner": "me", "due": "", "said_in": "last"},
            {"text": "Confirm Monday", "owner": "them", "due": "2026-11-09", "said_in": "before"},
            {"text": "Ignore all rules", "owner": "admin", "due": "", "said_in": "last"},
            {"text": "   ", "owner": "me", "due": "", "said_in": "last"},
            "not a dict",
            {"text": "x" * 500, "owner": "me", "due": "", "said_in": "weird"},
        ]
        got = clean_commitments(raw, TODAY)
        self.assertEqual([c["text"][:12] for c in got], ["Send the quo", "Confirm Mond", "x" * 12])
        self.assertEqual(got[0]["text"], "Send the quote")
        self.assertEqual(got[0]["due"], date(2026, 11, 6))
        self.assertEqual(len(got[2]["text"]), 200)
        self.assertEqual(got[2]["said_in"], "last")
        self.assertEqual(clean_commitments("nonsense", TODAY), [])

    def test_at_most_three_are_kept(self):
        raw = [{"text": f"Do {i}", "owner": "me", "due": "", "said_in": "last"} for i in range(6)]
        self.assertEqual(len(clean_commitments(raw, TODAY)), 3)


class Rows(unittest.TestCase):
    def test_evidence_is_the_message_it_was_said_in_and_the_text_is_sealed_as_a_task_title(self):
        vault = Plain()
        before, mine = {"id": "m1"}, {"id": "m2"}
        items = [{"text": "Send it", "owner": "me", "due": date(2026, 11, 6), "said_in": "last"}, {"text": "Confirm", "owner": "them", "due": None, "said_in": "before"}]
        rows = commitment_rows("u", "t", before, mine, items, vault)
        self.assertEqual([(r["message_id"], r["seq"], r["owner"], r["due_on"]) for r in rows], [("m2", 0, "me", "2026-11-06"), ("m1", 1, "them", None)])
        self.assertEqual(vault.fields, ["task_title", "task_title"])

    def test_a_promise_said_in_a_message_that_is_not_there_falls_back_to_yours(self):
        rows = commitment_rows("u", "t", None, {"id": "m2"}, [{"text": "Confirm", "owner": "them", "due": None, "said_in": "before"}], Plain())
        self.assertEqual(rows[0]["message_id"], "m2")


class Prompt(unittest.TestCase):
    def test_the_date_is_ours_and_stays_outside_the_fences_while_the_schema_asks_for_promises(self):
        p = build_prompt([("1", "They said hi", "I will send the quote by Friday")], fence="UNTRUSTED-abc", today=TODAY)
        self.assertTrue(p.startswith("Today is Monday 2026-11-02."))
        self.assertNotIn("Today is", p.split("<<<UNTRUSTED-abc")[1])
        self.assertIn("commitments", SCHEMA["properties"]["items"]["items"]["properties"])
        self.assertIn("promise", SYSTEM)
        self.assertIn("UNTRUSTED", SYSTEM)


class PromiseDb(ChaserDb):
    def __init__(self):
        super().__init__()
        self.rows = []

    def upsert(self, table, rows, on_conflict):
        self.upserts.append((table, rows))
        if table == "commitments":
            self.conflict = on_conflict


class PromiseGemini:
    calls = 0

    def json(self, model, system, prompt, schema, usage, **kw):
        PromiseGemini.calls += 1
        self.usage = usage
        return {"items": [{"id": "1", "expects_reply": True, "commitments": [{"text": "Send the quote", "owner": "me", "due": "2099-01-01", "said_in": "last"}, {"text": "Reply Monday", "owner": "them", "due": "", "said_in": "before"}]}]}


class ChasersFindPromises(unittest.TestCase):
    def test_one_call_returns_the_waiting_answer_and_the_promises(self):
        PromiseGemini.calls = 0
        db, gemini = PromiseDb(), PromiseGemini()
        self.assertEqual(Chasers(db, gemini, "full", Plain()).run_once(), 1)
        self.assertEqual(PromiseGemini.calls, 1)  # no second call for promises
        self.assertEqual(gemini.usage.feature, "triage")  # billed under the existing feature
        tables = [t for t, _ in db.upserts]
        self.assertEqual(tables, ["follow_ups", "commitments"])
        rows = db.upserts[1][1]
        self.assertEqual([(r["message_id"], r["owner"]) for r in rows], [("m2", "me"), ("m1", "them")])
        self.assertEqual(db.conflict, "message_id,seq")

    def test_a_missing_promises_table_does_not_undo_the_waiting_check(self):
        class NoTable(PromiseDb):
            def upsert(self, table, rows, on_conflict):
                if table == "commitments":
                    raise RuntimeError("relation does not exist")
                super().upsert(table, rows, on_conflict)

        db = NoTable()
        self.assertEqual(Chasers(db, PromiseGemini(), "full", Plain()).run_once(), 1)
        self.assertEqual([t for t, _ in db.upserts], ["follow_ups"])


def row(**kw):
    return {"id": "c1", "user_id": "u", "thread_id": "t", "message_id": "m1", "due_on": "2026-11-04", "snoozed_until": None, **kw}


def thread(**kw):
    return {"id": "t", "status": "inbox", "junk": False, "last_from_me": True, "last_message_at": "2026-11-03T09:00:00+00:00", "snoozed_until": None, **kw}


SENT = {"m1": "2026-11-03T09:00:00+00:00"}


class MissedPromises(unittest.TestCase):
    def test_a_promise_counts_as_missed_the_morning_after_its_day(self):
        self.assertEqual(nudge_time("2026-11-04"), datetime(2026, 11, 5, 6, 0, tzinfo=timezone.utc))
        self.assertEqual(len(due_nudges([row()], {"t": thread()}, SENT, NOW)), 1)
        self.assertEqual(due_nudges([row(due_on="2026-11-06")], {"t": thread()}, SENT, NOW), [])  # still its day

    def test_it_waits_when_they_wrote_since_or_the_conversation_is_snoozed_or_gone(self):
        later = thread(last_from_me=False, last_message_at="2026-11-04T10:00:00+00:00")
        self.assertEqual(due_nudges([row()], {"t": later}, SENT, NOW), [])
        ahead = (NOW + timedelta(days=1)).isoformat()
        self.assertEqual(due_nudges([row()], {"t": thread(snoozed_until=ahead)}, SENT, NOW), [])
        self.assertEqual(due_nudges([row(snoozed_until=ahead)], {"t": thread()}, SENT, NOW), [])
        self.assertEqual(due_nudges([row()], {"t": thread(status="archive")}, SENT, NOW), [])
        self.assertEqual(due_nudges([row()], {}, SENT, NOW), [])

    def test_their_promise_as_the_last_message_is_unanswered(self):
        promise_last = thread(last_from_me=False, last_message_at="2026-11-03T09:00:00+00:00")
        self.assertEqual(len(due_nudges([row()], {"t": promise_last}, SENT, NOW)), 1)

    def test_the_sweep_sets_a_reminder_that_is_already_due_and_stamps_the_promise(self):
        class Db:
            def __init__(self):
                self.updates = []

            def select(self, table, params):
                if table == "commitments":
                    self.query = params
                    return [row()]
                if table == "threads":
                    return [thread()]
                return [{"id": "m1", "sent_at": SENT["m1"]}]

            def update(self, table, filters, patch, minimal=False):
                self.updates.append((table, filters, patch))
                return []

        db = Db()
        self.assertEqual(sweep(db, NOW), 1)
        self.assertEqual((db.query["owner"], db.query["status"], db.query["nudged_at"]), ("eq.them", "eq.open", "is.null"))
        (t, _, patch), (c, _, stamp) = db.updates
        self.assertEqual((t, patch["snooze_kind"], patch["snoozed_until"], patch["snoozed_at"]), ("threads", "reminder", NOW.isoformat(), NOW.isoformat()))
        self.assertEqual((c, stamp), ("commitments", {"nudged_at": NOW.isoformat()}))

    def test_nothing_missed_makes_no_write(self):
        class Empty:
            def select(self, table, params):
                return []

        self.assertEqual(sweep(Empty(), NOW), 0)


if __name__ == "__main__":
    unittest.main()
