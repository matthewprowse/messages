import unittest

from ai.gemini import Gemini, GeminiError, UsageContext


class FakeDb:
    def __init__(self, features, week=None, setup=0.0, shares=None, week_shares=None):
        self.shares = shares
        self.week_shares = week_shares or {}
        self.features = features
        self.week = week or {}
        self.setup = setup
        self.calls = 0
        self.rows = []

    def rpc(self, function, args):
        if function == "ai_setup_state":
            return {"accounts": 1, "allowance": self.setup, "spent": 0}
        if function == "ai_allowance_shares_for":
            if self.shares is None:
                raise RuntimeError("no such function")
            return {"features": self.shares, "week_features": self.week_shares}
        self.calls += 1
        return {"used_pct": 50, "features": self.features, "week_features": self.week}

    def insert(self, table, row):
        self.rows.append(row)
        return []


class BudgetTest(unittest.TestCase):
    def gemini(self, features, week=None, setup=0.0, shares=None, week_shares=None):
        db = FakeDb(features, week, setup, shares, week_shares)
        return Gemini("key", db), db

    def test_feature_under_share_goes_ahead(self):
        g, _ = self.gemini({"draft": 99.9})
        g._check_budget(UsageContext("u", "draft"))

    def test_feature_over_share_pauses_only_that_feature(self):
        g, _ = self.gemini({"draft": 100, "triage": 10})
        with self.assertRaises(GeminiError):
            g._check_budget(UsageContext("u", "draft"))
        g._check_budget(UsageContext("u", "triage"))

    def test_read_once_a_minute(self):
        g, db = self.gemini({"draft": 1})
        for _ in range(5):
            g._check_budget(UsageContext("u", "draft"))
        self.assertEqual(db.calls, 1)

    def test_logos_are_never_paused(self):
        g, db = self.gemini({"logos": 500})
        g._check_budget(UsageContext("u", "logos"))
        self.assertEqual(db.calls, 0)

    def test_a_used_up_week_pauses_a_weekly_feature(self):
        g, _ = self.gemini({"draft": 10}, week={"draft": 100})
        with self.assertRaises(GeminiError):
            g._check_budget(UsageContext("u", "draft"))
        g._check_budget(UsageContext("u", "triage"))

    def test_setup_allowance_lets_sorting_through_a_used_up_month(self):
        g, _ = self.gemini({"triage": 100}, setup=2.0)
        g._check_budget(UsageContext("u", "triage"))

    def test_setup_allowance_does_not_cover_drafts(self):
        g, _ = self.gemini({"draft": 100}, setup=2.0)
        with self.assertRaises(GeminiError):
            g._check_budget(UsageContext("u", "draft"))

    def test_setup_calls_are_marked_and_use_up_the_allowance(self):
        from ai.gemini import Usage

        g, db = self.gemini({}, setup=0.01)
        g._insert_usage("m", UsageContext("u", "triage"), Usage(10, 0, 5, 0.006))
        g._insert_usage("m", UsageContext("u", "triage"), Usage(10, 0, 5, 0.006))
        g._insert_usage("m", UsageContext("u", "triage"), Usage(10, 0, 5, 0.006))
        self.assertEqual([r["setup"] for r in db.rows], [True, True, False])

    def test_unreadable_budget_fails_closed(self):
        g, _ = self.gemini({})
        g._db = object()  # no rpc at all
        with self.assertRaises(GeminiError) as raised:
            g._check_budget(UsageContext("u", "draft"))
        self.assertEqual(str(raised.exception), "gemini failed (None): budget_unknown")

    def test_an_empty_answer_fails_closed(self):
        g, db = self.gemini({})
        db.rpc = lambda function, args: None
        with self.assertRaises(GeminiError):
            g._check_budget(UsageContext("u", "triage"))

    def test_failed_read_is_not_cached(self):
        g, db = self.gemini({"draft": 1})
        good = db.rpc
        db.rpc = lambda function, args: (_ for _ in ()).throw(RuntimeError("down"))
        with self.assertRaises(GeminiError):
            g._check_budget(UsageContext("u", "draft"))
        db.rpc = good
        g._check_budget(UsageContext("u", "draft"))

    def test_calls_in_flight_cannot_overshoot_the_share(self):
        # Draft share is $1.00 of which 90% is used: $0.10 left. Each call is estimated at $0.04.
        g, _ = self.gemini({"draft": 90}, shares={"draft": 1.0})
        ctx = UsageContext("u", "draft")
        held = [g._check_budget(ctx, 0.04), g._check_budget(ctx, 0.04), g._check_budget(ctx, 0.04)]
        with self.assertRaises(GeminiError):  # 0.12 is held against 0.10: the fourth call is refused
            g._check_budget(ctx, 0.04)
        g._release(ctx, held[0])  # one finishes without spending: its hold is given back
        g._check_budget(ctx, 0.04)

    def test_spend_since_the_read_counts_before_the_row_is_written(self):
        from ai.gemini import Usage

        g, _ = self.gemini({"draft": 90}, shares={"draft": 1.0})
        ctx = UsageContext("u", "draft")
        g._check_budget(ctx)
        g._record("m", ctx, Usage(1, 0, 1, 0.11))  # more than the $0.10 left, within the 60 seconds
        with self.assertRaises(GeminiError):
            g._check_budget(ctx)
        g.close()

    def test_a_job_that_does_not_fit_is_refused_before_its_first_call(self):
        g, _ = self.gemini({"transcribe": 50}, shares={"transcribe": 1.0})  # $0.50 left
        ctx = UsageContext("u", "transcribe")
        with self.assertRaises(GeminiError):
            with g.hold(ctx, 0.60):
                self.fail("should not start")
        with g.hold(ctx, 0.40) as hold:
            with self.assertRaises(GeminiError):  # the hold is in the way of another job
                with g.hold(ctx, 0.40):
                    self.fail("should not start")
            self.assertEqual(hold.amount, 0.40)
        with g.hold(ctx, 0.40):  # released at the end
            pass

    def test_the_weekly_share_in_dollars_limits_too(self):
        g, _ = self.gemini({"draft": 0}, week={"draft": 50}, shares={"draft": 10.0}, week_shares={"draft": 1.0})
        ctx = UsageContext("u", "draft")
        with self.assertRaises(GeminiError):
            g._check_budget(ctx, 0.60, strict=True)
        g._check_budget(ctx, 0.40, strict=True)

    def test_without_share_dollars_only_percentages_are_checked(self):
        g, _ = self.gemini({"draft": 99}, shares=None)
        g._check_budget(UsageContext("u", "draft"), 50.0)

    def test_json_makes_no_call_when_the_allowance_cannot_be_read(self):
        class Stub(Gemini):
            called = False

            def _call(self, *a, **k):
                Stub.called = True
                return {}

        class Db:
            def rpc(self, function, args):
                raise RuntimeError("down")

            def insert(self, table, row):
                return []

        g = Stub("key", Db())
        with self.assertRaises(GeminiError):
            g.json("gemini-3.5-flash-lite", "s", "p", {}, UsageContext("u", "triage"))
        self.assertFalse(Stub.called)

    def test_json_releases_its_hold_when_the_call_fails(self):
        class Stub(Gemini):
            def _call(self, *a, **k):
                raise GeminiError(500, "boom")

        g, _ = self.gemini({"draft": 0}, shares={"draft": 1.0})
        stub = Stub("key", g._db)
        for _ in range(5):
            with self.assertRaises(GeminiError):
                stub.json("gemini-3.8-flash", "s", "p", {}, UsageContext("u", "draft"), max_output=50_000)
        self.assertEqual(stub._reserved.get(("u", "draft"), 0), 0)

    def test_a_timed_out_call_is_recorded_as_an_estimate(self):
        class Stub(Gemini):
            def _call(self, model, body, endpoint="", *, attempts=4, timeout=90, stats=None):
                stats["attempts"] = 2
                stats["lost"] = 2
                raise GeminiError(None, "TimeoutError")

        g, db = self.gemini({"triage": 0})
        stub = Stub("key", db)
        with self.assertRaises(GeminiError):
            stub.json("gemini-3.8-flash", "s", "p" * 3000, {}, UsageContext("u", "triage"))
        stub.close()
        self.assertEqual(len(db.rows), 2)
        self.assertGreater(db.rows[0]["cost_usd"], 0)
        self.assertEqual(db.rows[0]["output_tokens"], 0)

    def test_usage_rows_are_flushed_on_close(self):
        from ai.gemini import Usage

        g, db = self.gemini({})
        for _ in range(5):
            g._record("m", UsageContext("u", "draft"), Usage(1, 0, 1, 0.001))
        g.close()
        self.assertEqual(len(db.rows), 5)

    def test_a_failed_usage_write_is_tried_again(self):
        from ai.gemini import Usage
        import ai.gemini as module

        g, db = self.gemini({})
        outcomes = [RuntimeError("down"), None]
        real = db.insert

        def flaky(table, row):
            err = outcomes.pop(0)
            if err:
                raise err
            return real(table, row)

        db.insert = flaky
        slept = []
        original = module.time.sleep
        module.time.sleep = slept.append
        try:
            g._insert_usage("m", UsageContext("u", "draft"), Usage(1, 0, 1, 0.001))
        finally:
            module.time.sleep = original
        self.assertEqual(len(db.rows), 1)


class LimitsTest(unittest.TestCase):
    def test_limits_come_from_ai_budget_and_fall_back_to_defaults(self):
        class Db:
            def __init__(self, row):
                self.row = row

            def first(self, table, params):
                if isinstance(self.row, Exception):
                    raise self.row
                return self.row

        g = Gemini("key", Db({"regen_per_hour": 4, "auto_drafts_per_day": 2, "summaries_per_day": 9}))
        self.assertEqual(g.limits(), {"regen_per_hour": 4, "auto_drafts_per_day": 2, "summaries_per_day": 9})
        g = Gemini("key", Db(RuntimeError("down")))
        self.assertEqual(g.limits(), {"regen_per_hour": 10, "auto_drafts_per_day": 3, "summaries_per_day": 50})


class DraftLimitTest(unittest.TestCase):
    def drafts(self, made, limits=None):
        from ai.drafts import Drafts

        class Db:
            def __init__(self):
                self.counts = []
                self.updates = []

            def count(self, table, params):
                self.counts.append(params)
                return made

            def update(self, table, filters, patch, minimal=False):
                self.updates.append(patch)
                return []

        class G:
            def limits(self):
                return limits or {"regen_per_hour": 10, "auto_drafts_per_day": 3, "summaries_per_day": 50}

        db = Db()
        return Drafts(db, G(), "m"), db

    def test_under_the_hourly_limit_goes_ahead(self):
        d, db = self.drafts(9)
        self.assertFalse(d._limited({"id": "d1", "thread_id": "t", "auto": False}))
        self.assertEqual(db.counts[0]["auto"], "is.false")

    def test_over_the_hourly_limit_fails_with_a_reason(self):
        d, db = self.drafts(10)
        self.assertTrue(d._limited({"id": "d1", "thread_id": "t", "auto": False}))
        self.assertEqual(db.updates[0]["status"], "failed")

    def test_over_the_daily_auto_limit_expires_quietly(self):
        d, db = self.drafts(3)
        self.assertTrue(d._limited({"id": "d1", "thread_id": "t", "auto": True}))
        self.assertEqual(db.updates[0]["status"], "expired")

    def test_a_new_message_is_limited_per_person_instead(self):
        d, db = self.drafts(9)
        self.assertFalse(d._limited({"id": "d1", "user_id": "u", "thread_id": None, "auto": False}))
        self.assertEqual(db.counts[0]["user_id"], "eq.u")
        self.assertEqual(db.counts[0]["thread_id"], "is.null")
        d, db = self.drafts(10)
        self.assertTrue(d._limited({"id": "d1", "user_id": "u", "thread_id": None, "auto": False}))
        self.assertEqual(db.updates[0]["status"], "failed")

    def test_hedging_is_off_unless_asked_for(self):
        import os
        from ai.drafts import hedge_on

        os.environ.pop("DRAFT_HEDGE", None)
        self.assertFalse(hedge_on())
        os.environ["DRAFT_HEDGE"] = "true"
        try:
            self.assertTrue(hedge_on())
        finally:
            del os.environ["DRAFT_HEDGE"]


class SummaryCapTest(unittest.TestCase):
    def people(self, made, cap):
        from ai.people import People

        class Db:
            def count(self, table, params):
                return made if table == "contacts" else 0

        class G:
            def limits(self):
                return {"regen_per_hour": 10, "auto_drafts_per_day": 3, "summaries_per_day": cap}

        return People(Db(), G(), "m", "f")

    def test_summaries_stop_at_the_daily_cap(self):
        p = self.people(made=4, cap=5)
        self.assertTrue(p._summaries_left("u"))
        p._summarised("u")
        self.assertFalse(p._summaries_left("u"))


if __name__ == "__main__":
    unittest.main()
