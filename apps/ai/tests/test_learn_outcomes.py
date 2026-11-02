"""Tests for ai.learn.Learn: sent replies that cannot be learned from (no conversation, a foreign one) leave the
window instead of sitting in it for good, and a draft whose model step keeps failing waits out a back-off."""

import unittest

from ai.gemini import GeminiError
from ai.learn import Learn, UNFILED_LOOKS


class Db:
    def __init__(self, sent, thread=None):
        self.sent = sent  # outbox rows: id, draft_id, thread_id, user_id, body, drafts
        self.thread = thread
        self.outcomes = []
        self.id_queries = []

    def select(self, table, params):
        if table == "outbox" and "draft_id" in params.get("select", "") and "drafts(" not in params["select"]:
            return [{"id": s["id"], "draft_id": s["draft_id"]} for s in self.sent]
        if table == "outbox":
            wanted = params["id"][len("in.("):-1].replace('"', "").split(",")
            self.id_queries.append(wanted)
            return [s for s in self.sent if s["id"] in wanted]
        if table == "draft_outcomes":
            return []
        return []

    def first(self, table, params):
        return self.thread

    def insert(self, table, row):
        self.outcomes.append(row)
        return []

    def update(self, table, filters, patch, minimal=False):
        return []


class Gemini:
    def __init__(self, error=None):
        self.error = error
        self.calls = 0

    def json(self, *a, **kw):
        self.calls += 1
        if self.error:
            raise self.error
        return {"rules": []}


def row(n, thread="t1"):
    return {"id": f"o{n}", "draft_id": f"d{n}", "user_id": "u", "thread_id": thread, "body": "Totally different text here", "drafts": {"body": "Original draft", "status": "pending"}}


class LearnOutcomes(unittest.TestCase):
    def job(self, db, gemini):
        job = Learn(db, gemini, "m")
        job._rewrites_at = float("inf")  # rewrites are not under test
        return job

    def test_a_reply_in_a_missing_or_foreign_conversation_is_not_looked_at_again(self):
        db = Db([row(1)], thread=None)
        job = self.job(db, Gemini())
        job.run_once()
        job.run_once()
        self.assertEqual(len(db.id_queries), 1)  # the second pass left it out
        self.assertEqual(db.outcomes, [])

    def test_a_reply_with_no_conversation_yet_is_given_up_on_after_a_few_looks(self):
        db = Db([row(1, thread=None)])
        job = self.job(db, Gemini())
        for _ in range(UNFILED_LOOKS + 3):
            job.run_once()
        self.assertEqual(len(db.id_queries), UNFILED_LOOKS)

    def test_a_failing_model_step_backs_the_draft_off(self):
        db = Db([row(1)], thread={"account_id": "a", "user_id": "u"})
        gemini = Gemini(GeminiError(500, "boom"))
        job = self.job(db, gemini)
        job.run_once()
        job.run_once()
        self.assertEqual(gemini.calls, 1)

    def test_a_paused_budget_or_billing_is_not_a_try(self):
        for reason in ("budget_paused", "billing_paused"):
            db = Db([row(1)], thread={"account_id": "a", "user_id": "u"})
            job = self.job(db, Gemini(GeminiError(None, reason)))
            job.run_once()
            self.assertEqual(job._backoff.failures("d1"), 0, reason)


if __name__ == "__main__":
    unittest.main()
