"""Tests for pre-drafts asked for by triage (triage_predraft.py): only fresh mail that needs a reply, one per
conversation, and a database without queue_auto_draft stops the asking instead of failing triage."""

import unittest
from datetime import datetime, timedelta, timezone

from ai.supabase import SupabaseError
from ai.triage_predraft import PreDrafts, candidates


def msg(i, thread, hours_old=0.1):
    return {"id": i, "user_id": "u", "thread_id": thread, "sent_at": (datetime.now(timezone.utc) - timedelta(hours=hours_old)).isoformat()}


class Candidates(unittest.TestCase):
    def test_only_fresh_mail_that_needs_a_reply_from_them(self):
        updates = [msg("a", "t1"), msg("b", "t2"), msg("c", "t3"), msg("d", "t4", hours_old=30), msg("e", "t5"), msg("f", "t1")]
        final = {
            "a": {"needs_reply": True, "junk": False},
            "b": {"needs_reply": False, "junk": False},  # nothing to answer
            "c": {"needs_reply": True, "junk": True},  # junk
            "d": {"needs_reply": True, "junk": False},  # old: left to the app
            "e": {"needs_reply": True, "junk": False},  # they are not the one waiting
            "f": {"needs_reply": True, "junk": False},  # a second in t1
        }
        waiting = {"a": True, "b": True, "c": True, "d": True, "e": False, "f": True}
        self.assertEqual([m["id"] for m in candidates(updates, final, waiting)], ["a"])


class Queue(unittest.TestCase):
    def test_each_is_asked_for_and_a_missing_function_stops_the_asking(self):
        class Db:
            def __init__(self, error=None):
                self.calls, self.error = [], error

            def rpc(self, function, args):
                self.calls.append((function, args))
                if self.error:
                    raise self.error
                return "draft-id"

        db = Db()
        self.assertEqual(PreDrafts(db).queue([msg("a", "t1"), msg("b", "t2")]), 2)
        self.assertEqual(db.calls[0], ("queue_auto_draft", {"p_user": "u", "p_thread": "t1"}))

        gone = Db(SupabaseError(404, "PGRST202"))
        pre = PreDrafts(gone)
        self.assertEqual(pre.queue([msg("a", "t1"), msg("b", "t2")]), 0)
        self.assertEqual(len(gone.calls), 1)
        self.assertTrue(pre.missing)

        flaky = Db(SupabaseError(500, "XX000"))
        self.assertEqual(PreDrafts(flaky).queue([msg("a", "t1"), msg("b", "t2")]), 0)  # logged, never raised
        self.assertEqual(len(flaky.calls), 2)



class Suspicious(unittest.TestCase):
    def test_a_flagged_message_gets_no_pre_draft(self):
        updates = [msg("a", "t1"), msg("b", "t2")]
        final = {"a": {"needs_reply": True, "junk": False, "suspicious": "phishing"}, "b": {"needs_reply": True, "junk": False, "suspicious": None}}
        self.assertEqual([m["id"] for m in candidates(updates, final, {"a": True, "b": True})], ["b"])

if __name__ == "__main__":
    unittest.main()
