"""Idle polling intervals and the billing pause: the constants that keep an idle worker quiet, the draft loop's
sweep split, and that a billing_paused failure leaves a row queued instead of marking it failed."""

from __future__ import annotations

import time
import unittest

from ai.brief import IDLE_S as BRIEF_IDLE_S, POLL_S as BRIEF_POLL_S
from ai.bulk_read import BulkRead
from ai.drafts import AUDIO_SWEEP_EVERY_S, POLL_ACTIVE_S, POLL_IDLE_MAX_S, POLL_IDLE_S, SWEEP_EVERY_S, Drafts
from ai.gemini import GeminiError
from ai.poll import Backoff
from ai.retry import billing_paused
from ai.__main__ import BULK_READ_EVERY_S, BULK_READ_IDLE_S
from tests.test_bulk_read import FakeDb, FakeGemini, message


class Intervals(unittest.TestCase):
    def test_draft_loop_idles_slowly_but_a_found_draft_is_quick(self):
        d = Drafts(object(), object(), "m")
        waits = [d.poll_wait() for _ in range(8)]
        self.assertEqual(waits[0], POLL_IDLE_S)
        self.assertEqual(max(waits), POLL_IDLE_MAX_S)
        self.assertLessEqual(POLL_IDLE_MAX_S, 10)  # nothing wakes the loop, so this is a draft's worst first wait
        d._active_until = time.monotonic() + 60
        self.assertEqual(d.poll_wait(), POLL_ACTIVE_S)
        d._active_until = 0.0
        self.assertEqual(d.poll_wait(), POLL_IDLE_S)  # backed off from the start again

    def test_the_unindexed_audio_query_runs_far_less_often_than_the_stale_sweep(self):
        self.assertGreaterEqual(AUDIO_SWEEP_EVERY_S, 5 * SWEEP_EVERY_S)

    def test_brief_and_bulk_read_idle_at_30s_and_bulk_read_is_quick_when_busy(self):
        self.assertEqual(BRIEF_IDLE_S, 30)
        self.assertEqual(BULK_READ_IDLE_S, 30)
        b = Backoff(BULK_READ_EVERY_S, BULK_READ_IDLE_S)
        self.assertEqual([b.next(False) for _ in range(7)][-1], 30)
        self.assertEqual(b.next(True), 1.5)
        k = Backoff(BRIEF_POLL_S, BRIEF_IDLE_S)
        self.assertEqual([k.next(False) for _ in range(4)], [10, 20, 30, 30])


class Pause(unittest.TestCase):
    def test_matching_is_by_reason_string(self):
        self.assertTrue(billing_paused(GeminiError(None, "billing_paused")))
        self.assertFalse(billing_paused(GeminiError(500, "server error")))
        self.assertFalse(billing_paused(ValueError("x")))

    def test_bulk_read_keeps_the_request_without_an_error(self):
        db = FakeDb(message())
        BulkRead(db, FakeGemini(error=GeminiError(None, "billing_paused")), "fast", __import__("ai.vault", fromlist=["Vault"]).Vault(db)).run_once()
        self.assertEqual([p for t, f, p in db.updates if "error" in p], [])
        self.assertEqual(db.deleted, [])

    def test_a_held_draft_loop_does_not_ask_for_pending_drafts(self):
        calls = []

        class Db:
            def update(self, *a, **k):
                calls.append("update")

            def select(self, *a, **k):
                calls.append("select")
                return []

        d = Drafts(Db(), object(), "m")
        d._swept = d._audio_swept = time.monotonic()
        d._hold_until = time.monotonic() + 30
        self.assertEqual(d.run_once(), 0)
        self.assertEqual(calls, [])
        d._hold_until = 0.0
        d.run_once()
        self.assertEqual(calls, ["select"])

    def test_brief_requeues_instead_of_failing(self):
        from ai.brief import Brief

        updates, deletes = [], []

        class Db:
            def first(self, *a, **k):
                raise GeminiError(None, "billing_paused")

            def update(self, table, filters, patch, minimal=False):
                updates.append(patch)

            def delete(self, table, filters):
                deletes.append(filters)

        from datetime import date, datetime, timezone

        b = Brief(Db(), object(), "m", "t", "v", object())
        now = datetime.now(timezone.utc)
        self.assertEqual(b._write("b1", "u", date(2026, 10, 29), now), 0)
        self.assertEqual([p["status"] for p in updates], ["pending"])
        b._made.add(("u", "2026-10-29"))
        self.assertEqual(b._write("b2", "u", date(2026, 10, 29), now, speak=False), 0)
        self.assertEqual(len(deletes), 1)
        self.assertNotIn(("u", "2026-10-29"), b._made)
        self.assertEqual(b._speak_written("b3", "u"), 0)
        self.assertEqual(updates[-1]["status"], "speak_pending")


if __name__ == "__main__":
    unittest.main()
