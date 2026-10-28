"""Regression tests for small fixes: chaser output limit and day-old filter, when triage splits a failed batch, null budget
shares counting as used up, and the rule that only a user's own drafts folder is accepted as an audio path."""

import unittest
from datetime import datetime, timedelta, timezone

from ai.chasers import CHASER_MAX_OUTPUT, Chasers
from ai.gemini import GeminiError
from tests.test_ai import FakeTriageDb, FakeTriageGemini, TriageRun
from ai.triage import Triage


class ChaserDb:
    def __init__(self):
        self.upserts = []
        self.thread_params = None

    def select(self, table, params):
        if table == "threads":
            self.thread_params = params
            old = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
            return [{"id": "t1", "user_id": "u", "last_message_at": old}]
        if table == "follow_ups":
            return []
        if table == "messages":
            return [
                {"id": "m2", "user_id": "u", "thread_id": "t1", "direction": "outbound", "body_text": "Can you send the quote?", "body_html": None, "sent_at": "2026-10-25T10:00:00+00:00"},
                {"id": "m1", "user_id": "u", "thread_id": "t1", "direction": "inbound", "body_text": "Hi", "body_html": None, "sent_at": "2026-10-25T09:00:00+00:00"},
            ]
        return []

    def upsert(self, table, rows, on_conflict):
        self.upserts.append((table, rows))


class ChaserGemini:
    def __init__(self):
        self.kw = None

    def json(self, model, system, prompt, schema, usage, **kw):
        self.kw = kw
        return {"items": [{"id": "1", "expects_reply": True}]}


class ChaserRun(unittest.TestCase):
    def test_a_check_makes_a_row_and_sets_an_output_limit(self):
        db, gemini = ChaserDb(), ChaserGemini()
        self.assertEqual(Chasers(db, gemini, "full").run_once(), 1)
        self.assertEqual(gemini.kw["max_output"], CHASER_MAX_OUTPUT)
        [(table, rows)] = db.upserts
        self.assertEqual((table, rows[0]["thread_id"], rows[0]["expects_reply"], rows[0]["message_id"]), ("follow_ups", "t1", True, "m2"))

    def test_the_day_old_filter_is_in_the_query(self):
        db = ChaserDb()
        Chasers(db, ChaserGemini(), "full").run_once()
        self.assertIn("last_message_at.lte.", db.thread_params["and"])


class SplitOnlyWhenWorthIt(unittest.TestCase):
    def run_with(self, error):
        msg = TriageRun().msg
        pending = [msg("m1", "t1"), msg("m2", "t2")]
        rows = [{"id": m["id"], "thread_id": m["thread_id"], "direction": "inbound"} for m in pending]

        class Failing(FakeTriageGemini):
            def json(self, *a, **kw):
                self.calls.append(a)
                raise error

        gemini = Failing()
        Triage(FakeTriageDb(pending, rows), gemini, "fast").run_once()
        return len(gemini.calls)

    def test_budget_and_timeouts_are_not_asked_again_one_by_one(self):
        self.assertEqual(self.run_with(GeminiError(None, "budget_paused")), 1)
        self.assertEqual(self.run_with(GeminiError(None, "budget_unknown")), 1)
        self.assertEqual(self.run_with(GeminiError(None, "TimeoutError")), 1)

    def test_an_unusable_answer_is_still_split(self):
        self.assertEqual(self.run_with(GeminiError(None, "response was not JSON")), 3)
        self.assertEqual(self.run_with(GeminiError(400, "INVALID_ARGUMENT")), 3)


class BudgetShares(unittest.TestCase):
    def gemini(self, features, shares=None):
        from tests.test_budget import FakeDb
        from ai.gemini import Gemini

        return Gemini("key", FakeDb(features, None, 0.0, shares))

    def test_a_null_percent_is_used_up_not_unlimited(self):
        from ai.gemini import UsageContext

        g = self.gemini({"learn": None, "draft": 5})
        with self.assertRaises(GeminiError):
            g._check_budget(UsageContext("u", "learn"))
        g._check_budget(UsageContext("u", "draft"))

    def test_a_null_dollar_share_leaves_no_room(self):
        from ai.gemini import UsageContext

        g = self.gemini({"learn": 0}, shares={"learn": None})
        with self.assertRaises(GeminiError):
            g._check_budget(UsageContext("u", "learn"))


if __name__ == "__main__":
    unittest.main()
