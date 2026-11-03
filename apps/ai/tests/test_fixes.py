"""Regression tests for small fixes: chaser output limit and day-old filter, when triage splits a failed batch, null budget
shares counting as used up, and the rule that only a user's own drafts folder is accepted as an audio path."""

import unittest
from datetime import datetime, timedelta, timezone

from ai.chasers import CHASER_MAX_OUTPUT, Chasers, batch_ready
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


class ChaserBatching(unittest.TestCase):
    def test_a_user_is_asked_about_at_five_due_or_when_the_oldest_waited_twelve_hours(self):
        now = datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)
        ago = lambda hours: (now - timedelta(hours=hours)).isoformat()
        # Due a day after the last message: 25 hours old has been due for one hour.
        self.assertFalse(batch_ready([ago(25), ago(30)], now))
        self.assertTrue(batch_ready([ago(25)] * 5, now))
        self.assertTrue(batch_ready([ago(25), ago(37)], now))  # due 13 hours ago
        self.assertFalse(batch_ready([ago(35)], now))  # due 11 hours ago
        self.assertFalse(batch_ready([], now))

    def test_one_recently_due_conversation_waits_for_a_bigger_batch(self):
        class Fresh(ChaserDb):
            def select(self, table, params):
                if table == "threads":
                    return [{"id": "t1", "user_id": "u", "last_message_at": (datetime.now(timezone.utc) - timedelta(hours=26)).isoformat()}]
                return super().select(table, params)

        gemini = ChaserGemini()
        self.assertEqual(Chasers(Fresh(), gemini, "full").run_once(), 0)
        self.assertIsNone(gemini.kw)  # no call, and no message was read

    def test_ten_due_make_one_call_of_ten(self):
        class Many(ChaserDb):
            def select(self, table, params):
                old = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
                if table == "threads":
                    return [{"id": f"t{i}", "user_id": "u", "last_message_at": old} for i in range(12)]
                if table == "messages":
                    return [{"id": f"m{i}", "user_id": "u", "thread_id": f"t{i}", "direction": "outbound", "body_text": "Can you send it?", "body_html": None, "sent_at": old} for i in range(12)]
                return super().select(table, params)

        class Counting(ChaserGemini):
            calls = 0

            def json(self, *a, **kw):
                Counting.calls += 1
                return {"items": [{"id": str(i), "expects_reply": True} for i in range(1, 11)]}

        self.assertEqual(Chasers(Many(), Counting(), "full").run_once(), 10)
        self.assertEqual(Counting.calls, 1)  # the other two wait for the next run

    def test_every_candidate_thread_gets_its_own_read_of_its_latest_messages(self):
        reads = []

        class Busy(ChaserDb):
            def select(self, table, params):
                old = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
                if table == "threads":
                    return [{"id": f"t{i}", "user_id": "u", "last_message_at": old} for i in range(6)]
                if table == "messages":
                    reads.append((params["thread_id"], params["limit"]))
                    thread = params["thread_id"][len("in.("):-1].strip('"')
                    return [{"id": f"m-{thread}", "user_id": "u", "thread_id": thread, "direction": "outbound", "body_text": "Can you send it?", "body_html": None, "sent_at": old}]
                return super().select(table, params)

        Chasers(Busy(), ChaserGemini(), "full").run_once()
        self.assertEqual(sorted(r[0] for r in reads), sorted(f'in.("t{i}")' for i in range(6)))
        self.assertEqual({r[1] for r in reads}, {"3"})


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


class AudioPaths(unittest.TestCase):
    def test_only_the_users_own_drafts_folder_passes(self):
        from ai.drafts import own_audio_path

        self.assertTrue(own_audio_path("u1", "u1/drafts/abc.webm"))
        self.assertTrue(own_audio_path("u1", "u1/drafts/sub/abc-1_2.webm"))
        for bad in ("u1/drafts/../../u2/x.webm", "u1/drafts/..", "u1/drafts//x", "u1/drafts/./x", "u2/drafts/x.webm", "u1/other/x", "u1/drafts/", "u1/drafts/a b", "u1/drafts/x\n", None, ""):
            self.assertFalse(own_audio_path("u1", bad), bad)
        self.assertFalse(own_audio_path("", "/drafts/x"))

    def test_the_download_helper_refuses_dot_dot(self):
        from ai.supabase import Supabase, SupabaseError

        with self.assertRaises(SupabaseError):
            Supabase("http://x", "k").download("b", "u/drafts/../../v/x")


if __name__ == "__main__":
    unittest.main()


class TriageRegroup(unittest.TestCase):
    def test_missing_answers_are_asked_again_as_one_group(self):
        msg = TriageRun().msg
        pending = [msg("m1", "t1"), msg("m2", "t2"), msg("m3", "t3")]
        rows = [{"id": m["id"], "thread_id": m["thread_id"], "direction": "inbound"} for m in pending]

        class Partial(FakeTriageGemini):
            def json(self, model, system, prompt, schema, usage, **kw):
                self.calls.append((prompt, usage, kw))
                n = prompt.count("=== Message ")
                answered = 1 if len(self.calls) == 1 else n
                return {"results": [{"email": i, "priority": "normal", "category": "fyi", "junk": False, "needs_reply": False, "summary": "s"} for i in range(1, answered + 1)]}

        gemini = Partial()
        self.assertEqual(Triage(FakeTriageDb(pending, rows), gemini, "fast").run_once(), 3)
        self.assertEqual([c[0].count("=== Message ") for c in gemini.calls], [3, 2])  # not 3, then 1, then 1

    def test_bulk_mail_is_cut_shorter(self):
        from ai.triage import BODY_CHARS, BULK_BODY_CHARS

        self.assertLess(BULK_BODY_CHARS, BODY_CHARS)


class CostSettings(unittest.TestCase):
    def test_thinking_levels_default_and_can_be_set(self):
        import os
        from unittest import mock

        from ai import config

        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("DRAFT_THINKING", None)
            os.environ.pop("EDIT_THINKING", None)
            self.assertEqual((config.draft_thinking(), config.edit_thinking()), ("low", "medium"))
        with mock.patch.dict(os.environ, {"DRAFT_THINKING": "Minimal", "EDIT_THINKING": "nonsense"}):
            self.assertEqual((config.draft_thinking(), config.edit_thinking()), ("minimal", "medium"))

    def test_the_next_price_change_is_the_new_year(self):
        from datetime import date

        from ai.pricing import next_price_change

        self.assertEqual(next_price_change(date(2026, 10, 28)), date(2027, 1, 1))
        self.assertIsNone(next_price_change(date(2027, 1, 1)))

    def test_a_call_with_audio_gets_two_attempts(self):
        from ai.gemini import AUDIO_ATTEMPTS, Gemini

        g = Gemini.__new__(Gemini)
        g._no_minimal = set()
        g._check_budget = lambda *a, **k: 0.0
        g._release = lambda *a: None
        seen = []
        g._send_json = lambda *a: seen.append(a[6]) or {}
        g.json("m", "s", "p", {}, None, audio=(b"x", "audio/ogg"))
        g.json("m", "s", "p", {}, None)
        self.assertEqual(seen, [AUDIO_ATTEMPTS, 4])

    def test_older_messages_are_cut_shorter_in_a_draft(self):
        from ai.drafts import OLDER_CHARS, describe

        self.assertLess(len(describe({"body_text": "x" * 3000}, OLDER_CHARS)), OLDER_CHARS + 10)
        self.assertGreater(len(describe({"body_text": "x" * 3000})), 1400)


class VoiceProbe(unittest.TestCase):
    def test_only_users_with_new_sent_mail_are_looked_at(self):
        from ai.voice import Voice

        class Db:
            def __init__(self):
                self.tables = []
                self.sent = []

            def select(self, table, params):
                self.tables.append(table)
                if table == "messages":
                    return self.sent
                if table == "accounts":
                    return [{"id": "a1", "user_id": "u1"}, {"id": "a2", "user_id": "u2"}]
                return []

            def first(self, table, params):
                self.tables.append("first:" + table)
                return None

        db = Db()
        voice = Voice(db, None, "m")
        voice.run_once()  # the first pass looks at everyone
        self.assertEqual(db.tables.count("first:profiles"), 2)
        db.tables.clear()
        self.assertEqual(voice.run_once(), 0)
        self.assertEqual(db.tables, ["messages"])  # nothing new: no accounts, profiles or counts read
        db.tables.clear()
        voice._next.clear()
        db.sent = [{"user_id": "u2"}]
        voice.run_once()
        self.assertEqual(db.tables.count("first:profiles"), 1)
