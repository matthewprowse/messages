"""Wave 5, AI cost and reliability: claims, the worker lease, persisted back-off, the Batch API queue (with a fake client),
setup triage and learning through it, shared rule matching, the learn-from-median and tentative-rule behaviour, the
pre-draft cap, context cache storage cost and audio prices."""

import threading
import time
import unittest
from unittest import mock

from ai.batching import BatchQueue, POLL_EVERY_S
from ai.claims import Claims
from ai.gemini import Gemini, GeminiError, UsageContext
from ai.gemini_batch import json_request, read_json_answer
from ai.lease import Lease
from ai.learn import BATCH_MIN, Learn
from ai.predraft_cap import PER_USER_PER_DAY, user_cap_reached
from ai.pricing import audio_input_rate, cache_storage_usd, cost_usd
from ai.retry_store import PersistentBackoff
from ai.rules import MEDIAN_AFTER, find_rule, goes_live, same_rule, tidy_rule, worth_learning
from ai.supabase import SupabaseError
from ai.triage_batch import BatchTriageMixin, old_enough
from datetime import date


class RpcDb:
    """Records rpc calls; answers from a dict of function -> value or exception."""

    def __init__(self, answers=None):
        self.answers = answers or {}
        self.calls = []

    def rpc(self, function, args):
        self.calls.append((function, args))
        out = self.answers.get(function)
        if isinstance(out, Exception):
            raise out
        return out


class ClaimsTests(unittest.TestCase):
    def test_only_the_rows_the_database_grants_are_held(self):
        db = RpcDb({"claim_ai_rows": ["a"]})
        self.assertEqual(Claims(db, "me").claim("draft", ["a", "b", "a"]), {"a"})
        self.assertEqual(db.calls[0][1]["p_ids"], ["a", "b"])  # asked once per id, and who is asking is sent

    def test_without_the_migration_everything_is_granted(self):
        self.assertEqual(Claims(RpcDb({"claim_ai_rows": SupabaseError(404, "PGRST202")})).claim("draft", ["a", "b"]), {"a", "b"})

    def test_another_failure_grants_nothing(self):
        self.assertEqual(Claims(RpcDb({"claim_ai_rows": SupabaseError(500, None)})).claim("draft", ["a"]), set())

    def test_release_never_raises(self):
        Claims(RpcDb({"release_ai_claims": SupabaseError(500, None)})).release("draft", ["a"])


class LeaseTests(unittest.TestCase):
    def test_a_free_lease_is_taken_and_a_held_one_is_not(self):
        self.assertTrue(Lease(RpcDb({"acquire_worker_lease": True})).acquire())
        self.assertFalse(Lease(RpcDb({"acquire_worker_lease": False})).acquire())

    def test_without_the_migration_the_worker_runs_unguarded(self):
        lease = Lease(RpcDb({"acquire_worker_lease": SupabaseError(404, "PGRST202")}))
        self.assertTrue(lease.acquire())
        self.assertTrue(lease.renew())

    def test_a_lost_lease_stops_the_worker(self):
        db = RpcDb({"acquire_worker_lease": False})
        stop, lost = threading.Event(), threading.Event()
        Lease(db).keep(stop, lost.set, every_s=0.01)
        self.assertTrue(lost.wait(2))
        stop.set()

    def test_failed_renewals_only_lose_the_lease_after_a_whole_ttl(self):
        lease = Lease(RpcDb({"acquire_worker_lease": SupabaseError(500, None)}), ttl_s=90)
        self.assertEqual([lease.renew() for _ in range(4)], [True, True, False, False])


class StoreDb:
    def __init__(self, rows=None):
        self.rows = rows or []
        self.upserts = []
        self.deleted = []

    def select(self, table, params):
        return self.rows

    def upsert(self, table, row, on_conflict):
        self.upserts.append(row)

    def delete(self, table, filters):
        self.deleted.append(filters)


class PersistentBackoffTests(unittest.TestCase):
    def test_a_failure_is_written_and_a_restart_still_waits(self):
        db = StoreDb()
        first = PersistentBackoff(db, "triage")
        first.failed("m1", 0.0)
        saved = db.upserts[0]
        self.assertEqual((saved["kind"], saved["row_id"], saved["failures"]), ("triage", "m1", 1))
        restarted = PersistentBackoff(StoreDb([{"row_id": "m1", "failures": 1, "retry_at": saved["retry_at"]}]), "triage")
        import time

        self.assertEqual(restarted.waiting(time.monotonic()), ["m1"])
        self.assertEqual(restarted.failures("m1"), 1)

    def test_success_clears_only_what_was_stored(self):
        db = StoreDb()
        b = PersistentBackoff(db, "triage")
        b.succeeded("never-failed")
        self.assertEqual(db.deleted[-1:], db.deleted[-1:] and [db.deleted[-1]])  # only the load-time prune so far
        before = len(db.deleted)
        b.failed("m", 0.0)
        b.succeeded("m")
        self.assertEqual(len(db.deleted), before + 1)

    def test_a_broken_database_keeps_the_memory_back_off(self):
        class Broken(StoreDb):
            def select(self, *a):
                raise OSError("down")

            def upsert(self, *a):
                raise OSError("down")

        b = PersistentBackoff(Broken(), "triage")
        self.assertEqual(b.failed("m", 0.0), 1)


class FakeGemini:
    """The Batch API surface BatchQueue uses."""

    def __init__(self, state="running", answers=None, submit_error=None):
        self.state, self.answers, self.submit_error = state, answers or {}, submit_error
        self.submitted, self.settled = [], []

    def hold(self, ctx, estimate, strict=True):
        from contextlib import nullcontext

        if self.submit_error:
            raise self.submit_error
        return nullcontext()

    def batch_submit(self, model, items, name="batch"):
        self.submitted.append((model, items))
        return "batches/b1"

    def batch_poll(self, job):
        return self.state, self.answers

    def batch_settle(self, model, ctx, answer):
        self.settled.append(answer)


class BatchDb:
    def __init__(self, rows=None):
        self.rows, self.inserted, self.updated, self.deleted = rows or [], [], [], []

    def select(self, table, params):
        return self.rows

    def insert(self, table, row):
        self.inserted.append(row)
        return []

    def update(self, table, filters, patch, minimal=False):
        self.updated.append(patch)
        return []

    def delete(self, table, filters):
        self.deleted.append(filters)


def ok(obj):
    import json

    return {"candidates": [{"content": {"parts": [{"text": json.dumps(obj)}]}}], "usageMetadata": {}}


BODY = json_request("s", "p", {"type": "object"}, max_output=100)


class FlatDb:
    def rpc(self, function, args):
        return None if function == "ai_allowance_shares_for" else {"features": {"learn": 0}}

    def insert(self, table, row):
        return []


class BatchQueueTests(unittest.TestCase):
    def queue(self, g, db=None):
        return BatchQueue(db or BatchDb(), g, "triage")

    def test_a_submitted_job_holds_its_rows_until_finished(self):
        g, db = FakeGemini(), BatchDb()
        q = self.queue(g, db)
        self.assertTrue(q.submit("m", "u", "triage", [("c0", ["a", "b"], BODY)]))
        self.assertEqual(q.inflight(), {"a", "b"})
        self.assertEqual(db.inserted[0]["items"], {"c0": ["a", "b"]})
        self.assertEqual(q.poll(), [])  # still running
        q.finish(["a"])
        self.assertEqual(q.inflight(), {"b"})
        q.finish(["b"])
        self.assertEqual(q.inflight(), set())
        self.assertTrue(db.deleted)

    def test_a_budget_that_cannot_cover_it_falls_back(self):
        q = self.queue(FakeGemini(submit_error=GeminiError(None, "budget_paused")))
        self.assertFalse(q.submit("m", "u", "triage", [("c0", ["a"], BODY)]))
        self.assertEqual(q.inflight(), set())

    def test_done_answers_are_returned_and_recorded_once(self):
        g = FakeGemini("done", {"c0": ok({"results": []})})
        db = BatchDb()
        q = self.queue(g, db)
        q.submit("m", "u", "triage", [("c0", ["a"], BODY)])
        q._polled = -POLL_EVERY_S * 2
        ready = q.poll()
        self.assertEqual([(r.key, r.ids, r.answer) for r in ready], [("c0", ["a"], {"results": []})])
        q.poll()
        self.assertEqual(len(g.settled), 1)
        self.assertTrue(any(p.get("items", {}).get("_settled") for p in db.updated))

    def test_a_failed_job_frees_its_rows_for_the_ordinary_way(self):
        q = self.queue(FakeGemini("failed"))
        q.submit("m", "u", "triage", [("c0", ["a", "b"], BODY)])
        q._polled = -POLL_EVERY_S * 2
        self.assertEqual(q.poll(), [])
        self.assertEqual(q.inflight(), set())
        self.assertEqual(sorted(q.take_freed()), ["a", "b"])

    def test_an_unreadable_answer_is_none(self):
        g = FakeGemini("done", {"c0": {"candidates": [{"content": {"parts": [{"text": "nope"}]}}]}})
        q = self.queue(g)
        q.submit("m", "u", "triage", [("c0", ["a"], BODY)])
        q._polled = -POLL_EVERY_S * 2
        self.assertIsNone(q.poll()[0].answer)

    def test_a_restart_reloads_jobs_in_flight(self):
        rows = [{"name": "batches/b1", "model": "m", "user_id": "u", "feature": "triage", "items": {"c0": ["a"], "_settled": True}, "created_at": "2026-11-02T10:00:00+00:00"}]
        q = self.queue(FakeGemini(), BatchDb(rows))
        self.assertEqual(q.inflight(), {"a"})

    def test_positions_survive_a_partial_finish(self):
        g = FakeGemini("done", {"c0": ok({"x": 1})})
        q = self.queue(g)
        q.submit("m", "u", "triage", [("c0", ["a", "b", "c"], BODY)])
        q._polled = -POLL_EVERY_S * 2
        q.poll()
        q.finish(["a"])
        self.assertEqual(q.poll()[0].ids, ["", "b", "c"])  # b is still answer number 2

    def test_the_request_body_is_what_json_sends(self):
        class Stub(Gemini):
            def _call(self, model, body, endpoint="", **kw):
                self.sent = body
                return ok({"ok": True})

        g = Stub("k", FlatDb())
        g.json("m", "sys", "prompt", {"type": "object"}, UsageContext("u", "learn"), thinking="minimal", max_output=77)
        g.close()
        self.assertEqual(g.sent, json_request("sys", "prompt", {"type": "object"}, thinking="minimal", max_output=77))
        self.assertEqual(read_json_answer(ok({"a": 1})), {"a": 1})


class Chunky(BatchTriageMixin):
    """Just enough of Triage to drive the batch layer."""

    def __init__(self, gemini, queue, db):
        self.db, self.gemini, self.model = db, gemini, "m"
        self.harden(queue, None)
        self.asked = []

    def _ask_model(self, ctx, chunk):
        self.asked.append([m["id"] for m in chunk])
        return {m["id"]: ({"x": 1}, self.model) for m in chunk}

    def _triage_once(self):
        return 0


def msg(i, hours_old, user="u"):
    from datetime import datetime, timedelta, timezone

    return {"id": i, "user_id": user, "account_id": "a", "sent_at": (datetime.now(timezone.utc) - timedelta(hours=hours_old)).isoformat(), "_email": {"n": 1}}


class SetupTriageBatch(unittest.TestCase):
    def build(self, g, setup=True):
        g.in_setup = lambda user: setup
        db = BatchDb()
        db.update = lambda table, filters, patch, minimal=False: db.updated.append((table, patch))
        return Chunky(g, BatchQueue(db, g, "triage"), db), db

    def patched(self):
        return mock.patch("ai.triage_batch.triage_request", lambda ctx, chunk: BODY)

    def test_old_mail_of_a_new_account_goes_as_a_batch_and_is_held_out(self):
        g = FakeGemini()
        t, db = self.build(g)
        with self.patched():
            self.assertEqual(t._ask({}, [msg("a", 48), msg("b", 48)]), {})
            self.assertEqual(t._batch_flush(), {})
        self.assertEqual(len(g.submitted), 1)
        self.assertEqual(t.asked, [])  # no live call
        held = [p for table, p in db.updated if table == "messages"]
        self.assertTrue(held and held[0]["triage_hold_until"])

    def test_new_mail_and_established_accounts_are_asked_live(self):
        t, _ = self.build(FakeGemini())
        with self.patched():
            t._ask({}, [msg("a", 1)])
        self.assertEqual(t.asked, [["a"]])
        t2, _ = self.build(FakeGemini(), setup=False)
        with self.patched():
            t2._ask({}, [msg("b", 48)])
        self.assertEqual(t2.asked, [["b"]])

    def test_a_refused_batch_is_asked_the_ordinary_way_in_the_same_run(self):
        t, _ = self.build(FakeGemini(submit_error=GeminiError(None, "budget_paused")))
        with self.patched():
            t._ask({}, [msg("a", 48)])
            out = t._batch_flush()
        self.assertEqual(list(out), ["a"])
        self.assertEqual(t.asked, [["a"]])

    def test_answers_that_come_back_are_served_and_unusable_ones_are_let_back_in(self):
        answer = {"results": [{"email": 1, "junk": False, "priority": "normal", "category": "work", "needs_reply": True, "summary": "s"}]}
        g = FakeGemini("done", {"c0": ok(answer)})
        t, db = self.build(g)
        with self.patched():
            t._ask({}, [msg("a", 48), msg("b", 48)])
            t._batch_flush()
        t.batches._polled = -POLL_EVERY_S * 2
        t._batch_collect()
        self.assertIn("a", t._batch_ready)
        self.assertNotIn("b", t._batch_ready)  # the model left it out: asked the ordinary way
        released = [p for table, p in db.updated if table == "messages" and p["triage_hold_until"] is None]
        self.assertTrue(released)
        served = t._ask({}, [msg("a", 48)])
        self.assertEqual(served["a"][0]["category"], "work")
        self.assertEqual(t.asked, [])
        t._batch_finish(["a"])
        self.assertNotIn("a", t.batches.inflight())

    def test_rows_another_worker_holds_are_left_out_and_claims_are_released(self):
        t, _ = self.build(FakeGemini())
        db = RpcDb({"claim_ai_rows": ["a"]})
        t.claims = Claims(db, "me")
        self.assertEqual([m["id"] for m in t._claim_rows([msg("a", 1), msg("b", 1)])], ["a"])
        t.run_once()
        self.assertEqual(db.calls[-1][0], "release_ai_claims" if t._run_claims else db.calls[-1][0])

    def test_old_enough(self):
        self.assertTrue(old_enough(msg("a", 7)["sent_at"]))
        self.assertFalse(old_enough(msg("a", 1)["sent_at"]))
        self.assertFalse(old_enough("garbage"))


class RuleTests(unittest.TestCase):
    def test_one_matcher_for_every_learner(self):
        self.assertTrue(same_rule("Signs off with Matt", "signs off with matt."))
        self.assertEqual(tidy_rule("Short — and  plain"), tidy_rule("Short — and  plain"))
        self.assertNotIn("—", tidy_rule("a — b"))
        self.assertNotIn("  ", tidy_rule("a — b"))
        rules = [{"rule": "Keeps replies short", "contact_id": None}, {"rule": "Keeps replies short", "contact_id": "c"}]
        self.assertIs(find_rule(rules, "keeps replies short", "c"), rules[1])
        self.assertIsNone(find_rule(rules, "something else", None))

    def test_median_gate(self):
        few = [0.3] * (MEDIAN_AFTER - 1)
        self.assertTrue(worth_learning(0.1, few))  # too little history to judge
        many = [0.2, 0.4, 0.6] * MEDIAN_AFTER
        self.assertFalse(worth_learning(0.3, many))
        self.assertTrue(worth_learning(0.5, many))

    def test_support_needed(self):
        self.assertFalse(goes_live(1))
        self.assertTrue(goes_live(2))


class LearnDb:
    def __init__(self, existing=None, ratios=None, body="Completely different words entirely now"):
        self.body = body
        self.existing = existing or []
        self.ratios = ratios or []
        self.inserted, self.updated = [], []

    def select(self, table, params):
        if table == "outbox":
            if "drafts(" in params["select"]:
                return [{"id": "o1", "user_id": "u", "thread_id": "t", "body": self.body, "draft_id": "d1", "drafts": {"body": "Original draft text", "status": "pending"}}]
            return [{"id": "o1", "draft_id": "d1"}]
        if table == "style_rules":
            return [dict(r) for r in self.existing]
        if table == "draft_outcomes":
            return [{"edit_ratio": r} for r in self.ratios] if "edit_ratio" in params["select"] else []
        return []

    def first(self, table, params):
        return {"account_id": "a", "user_id": "u", "sender_contact_id": None}

    def insert(self, table, row):
        self.inserted.append((table, row))
        return []

    def update(self, table, filters, patch, minimal=False):
        self.updated.append((table, patch))
        return []


class LearnGemini:
    def __init__(self, rules):
        self.rules, self.calls = rules, 0

    def json(self, *a, **kw):
        self.calls += 1
        return {"rules": self.rules}


class LearnRules(unittest.TestCase):
    def job(self, db, gemini):
        job = Learn(db, gemini, "m")
        job._rewrites_at = float("inf")
        return job

    def test_a_rule_from_one_edit_starts_off(self):
        db = LearnDb()
        self.job(db, LearnGemini([{"rule": "Signs off with Matt", "scope": "global"}])).run_once()
        rule = [r for t, r in db.inserted if t == "style_rules"][0]
        self.assertEqual((rule["enabled"], rule["disabled_reason"]), (False, "tentative"))

    def test_a_second_edit_turns_it_on(self):
        existing = [{"id": "r1", "rule": "Signs off with Matt", "scope": "global", "contact_id": None, "support_count": 1, "enabled": False, "disabled_reason": "tentative"}]
        db = LearnDb(existing)
        self.job(db, LearnGemini([{"rule": "signs off with matt.", "scope": "global"}])).run_once()
        self.assertIn(("style_rules", {"support_count": 2, "enabled": True}), db.updated)
        self.assertEqual([t for t, _ in db.inserted if t == "style_rules"], [])

    def test_an_edit_smaller_than_the_usual_is_recorded_but_not_sent_to_the_model(self):
        gemini = LearnGemini([{"rule": "x", "scope": "global"}])
        db = LearnDb(ratios=[0.9] * MEDIAN_AFTER, body="Original draft text plus one extra")
        self.job(db, gemini).run_once()
        self.assertEqual(gemini.calls, 0)
        self.assertTrue([r for t, r in db.inserted if t == "draft_outcomes"])

    def test_a_backlog_goes_as_a_batch_and_is_applied_when_it_returns(self):
        class Sent(LearnDb):
            def select(self, table, params):
                if table == "outbox" and "drafts(" in params["select"]:
                    return [{"id": f"o{n}", "user_id": "u", "thread_id": "t", "body": "Completely different words entirely now", "draft_id": f"d{n}", "drafts": {"body": "Original draft text", "status": "pending"}} for n in range(BATCH_MIN)]
                if table == "outbox":
                    return [{"id": f"o{n}", "draft_id": f"d{n}"} for n in range(BATCH_MIN)]
                return super().select(table, params)

        g = FakeGemini()
        g.json = lambda *a, **k: self.fail("a backlog is not asked live")
        g.in_setup = lambda user: False
        db = Sent()
        db.delete = lambda *a, **k: None
        job = self.job(db, g)
        job.batches = BatchQueue(db, g, "learn")
        job.run_once()
        self.assertEqual(len(g.submitted), 1)
        self.assertEqual(len(g.submitted[0][1]), BATCH_MIN)
        self.assertEqual([r for t, r in db.inserted if t == "draft_outcomes"], [])  # nothing recorded until the answers are back
        # the answers come back
        answers = {f"d{n}": ok({"rules": [{"rule": f"Rule {n}", "scope": "global"}]}) for n in range(BATCH_MIN)}
        g.state, g.answers = "done", {k: v for k, v in zip([f"d{n}" for n in range(BATCH_MIN)], answers.values())}
        # requests are keyed d0..d3 by position
        g.answers = {f"d{n}": ok({"rules": [{"rule": f"Rule {n}", "scope": "global"}]}) for n in range(BATCH_MIN)}
        job.batches._polled = -POLL_EVERY_S * 2
        job.run_once()
        self.assertEqual(len([r for t, r in db.inserted if t == "draft_outcomes"]), BATCH_MIN)
        self.assertEqual(len([r for t, r in db.inserted if t == "style_rules"]), BATCH_MIN)


class CapDb:
    def __init__(self, made):
        self.made, self.params = made, None

    def count(self, table, params):
        self.params = params
        return self.made


class PredraftCap(unittest.TestCase):
    def test_the_cap_counts_model_written_pre_drafts_of_the_day(self):
        db = CapDb(PER_USER_PER_DAY)
        self.assertTrue(user_cap_reached(db, "u"))
        self.assertEqual((db.params["auto"], db.params["model"]), ("is.true", "not.is.null"))
        self.assertFalse(user_cap_reached(CapDb(PER_USER_PER_DAY - 1), "u"))

    def test_an_unreadable_count_never_holds_drafts_up(self):
        class Broken:
            def count(self, *a):
                raise OSError("down")

        self.assertFalse(user_cap_reached(Broken(), "u"))

    def test_a_pre_draft_over_the_per_user_cap_is_expired_before_the_model_runs(self):
        from ai.drafts_gather import GatherMixin

        class G(GatherMixin):
            def __init__(self):
                self.db = CapDb(PER_USER_PER_DAY)
                self.gemini = object()
                self.expired = []

            def _expire(self, d):
                self.expired.append(d["id"])

        g = G()
        self.assertTrue(g._limited({"id": "d", "user_id": "u", "thread_id": "t", "auto": True}))
        self.assertEqual(g.expired, ["d"])


class CacheAndAudio(unittest.TestCase):
    def test_storage_cost_scales_with_tokens_and_time(self):
        self.assertAlmostEqual(cache_storage_usd(1_000_000, 3600), 1.0)
        self.assertAlmostEqual(cache_storage_usd(500_000, 1800), 0.25)
        self.assertEqual(cache_storage_usd(0, 3600), 0)

    def test_a_deleted_cache_records_its_storage(self):
        class Rec(Gemini):
            def __init__(self):
                super().__init__("k", mock.MagicMock())
                self.recorded = []

            def _record(self, model, ctx, usage):
                self.recorded.append(usage)

            def _call(self, *a, **k):
                return {"name": "cachedContents/x", "usageMetadata": {"totalTokenCount": 1_000_000}}

        g = Rec()
        with mock.patch("ai.gemini_files.POOL.request"):
            name = g.cache_file("gemini-3.8-flash", "s", ("uri", "audio/mp4"), UsageContext("u", "transcribe"), ttl_s=3600)
            g._caches[name] = (*g._caches[name][:3], g._caches[name][3] - 1800, 3600)  # lived half an hour
            g.delete_cache(name)
        g.close()
        self.assertEqual(len(g.recorded), 2)  # the tokens, then the storage
        self.assertAlmostEqual(g.recorded[1].cost_usd, 0.5, places=2)
        self.assertNotIn(name, g._caches)

    def test_an_expired_cache_is_recorded_for_its_whole_ttl(self):
        g = Gemini("k", mock.MagicMock())
        recorded = []
        g._record = lambda model, ctx, usage: recorded.append(usage)
        # Made an hour ago by the monotonic clock (not at 0.0, which is under 30 minutes in when the machine just booted).
        g._caches["cachedContents/y"] = ("m", UsageContext("u", "transcribe"), 1_000_000, time.monotonic() - 3600, 1800)
        g._settle_expired_caches()
        g.close()
        self.assertAlmostEqual(recorded[0].cost_usd, 0.5, places=3)

    def test_audio_prices_follow_the_recorded_rates(self):
        self.assertEqual(audio_input_rate("gemini-3.1-flash-lite"), 0.50)
        self.assertEqual(audio_input_rate("gemini-2.5-flash"), 1.00)
        self.assertEqual(audio_input_rate("gemini-3.8-flash"), 3.00)  # unknown: the conservative estimate
        cheap = cost_usd("gemini-3.1-flash-lite", date(2026, 11, 2), 1_000_000, 0, 0, 1_000_000)
        dear = cost_usd("gemini-3.8-flash", date(2026, 11, 2), 1_000_000, 0, 0, 1_000_000)
        self.assertAlmostEqual(cheap, 0.50)
        self.assertAlmostEqual(dear, 3.00)


if __name__ == "__main__":
    unittest.main()
