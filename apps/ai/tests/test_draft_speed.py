"""Tests for how quickly a draft is written: its reads run at the same time instead of one after another, the draft
limit is read alongside them and still stops the model call, and the budget is read ahead of the call."""

import threading
import unittest

from ai.drafts import Drafts
from ai.gemini_types import GeminiError
from ai.vault import Vault
from tests.test_vault import MASTER_B64, DraftsDb, DraftsGemini, FakeEmbeddings


class Together(DraftsDb):
    """DraftsDb whose draft_context and settings reads each wait until the others have been asked for: a draft only
    gets past them when they run at the same time (one after another, the first would wait forever)."""

    def __init__(self, parties: int):
        super().__init__()
        self.meet = threading.Barrier(parties, timeout=5)
        self.counted = 0

    def rpc(self, function, args):
        if function == "draft_context":
            self.meet.wait()
        return super().rpc(function, args)

    def select(self, table, params):
        if table in ("profiles", "calendar_events", "attachments"):
            self.meet.wait()
        return super().select(table, params)

    def count(self, table, params):
        self.counted += 1
        return 0


class Concurrent(unittest.TestCase):
    def test_reads_that_do_not_need_the_context_run_with_it(self):
        db, gemini = Together(4), DraftsGemini()  # draft_context, the tone in Settings, the calendar, the files on offer
        drafts = Drafts(db, gemini, "m", FakeEmbeddings(), Vault(db, MASTER_B64, True))
        self.assertEqual(drafts.run_once(), 1)
        drafts._runner.shutdown(wait=True)
        self.assertEqual(len(gemini.prompts), 1)
        self.assertFalse(db.meet.broken)
        self.assertEqual(db.counted, 1)  # the draft limit was still read

    def test_a_limited_draft_is_failed_and_never_asks_the_model(self):
        class Over(DraftsDb):
            def count(self, table, params):
                return 999

        db, gemini = Over(), DraftsGemini()
        drafts = Drafts(db, gemini, "m", FakeEmbeddings(), Vault(db, MASTER_B64, True))
        drafts.run_once()
        drafts._runner.shutdown(wait=True)
        self.assertEqual(gemini.prompts, [])
        [failed] = [u for u in db.updates if u[1] == {"id": "eq.d1"} and u[2].get("status") == "failed"]
        self.assertIn("a lot of drafts", failed[2]["error"])

    def test_the_budget_is_read_while_the_context_is(self):
        class Preloading(DraftsGemini):
            def __init__(self):
                super().__init__()
                self.preloaded: list[tuple[str, str]] = []

            def preload(self, user_id, feature):
                self.preloaded.append((user_id, feature))

        db, gemini = DraftsDb(), Preloading()
        drafts = Drafts(db, gemini, "m", FakeEmbeddings(), Vault(db, MASTER_B64, True))
        drafts.run_once()
        drafts._runner.shutdown(wait=True)
        self.assertEqual(gemini.preloaded, [("u", "draft")])
        self.assertEqual(len(gemini.prompts), 1)


class OneKeyRead(unittest.TestCase):
    def test_threads_asking_for_a_key_at_once_read_it_once(self):
        from tests.test_vault import wrapped_row

        class Db:
            def __init__(self):
                self.reads = 0
                self.gate = threading.Event()

            def first(self, table, params):
                self.reads += 1
                self.gate.wait(5)  # held until every thread has asked
                return wrapped_row("u")

        db = Db()
        vault = Vault(db, MASTER_B64, True)
        got: list = []
        threads = [threading.Thread(target=lambda: got.append(vault.keys_for("u"))) for _ in range(4)]
        for t in threads:
            t.start()
        db.gate.set()
        for t in threads:
            t.join(5)
        self.assertEqual(db.reads, 1)
        self.assertEqual(len(got), 4)
        self.assertTrue(all(k is got[0] and k is not None for k in got))


class Preload(unittest.TestCase):
    def test_preload_reads_the_allowance_once_and_never_raises(self):
        from ai.gemini import Gemini

        class Db:
            def __init__(self):
                self.rpcs: list[str] = []

            def select(self, table, params):
                return []

            def rpc(self, function, args):
                self.rpcs.append(function)
                if function == "ai_allowance_for":
                    return {"features": {"draft": 10.0}, "week_features": {}}
                return {}

        db = Db()
        gemini = Gemini("k", db)
        gemini.preload("u", "draft")
        self.assertIn("ai_allowance_for", db.rpcs)
        before = len(db.rpcs)
        gemini._check_budget(type("Ctx", (), {"user_id": "u", "feature": "draft", "account_id": None, "thread_id": None})())
        self.assertEqual(len(db.rpcs), before)  # the call found it cached

        class Broken(Db):
            def rpc(self, function, args):
                raise RuntimeError("down")

        Gemini("k", Broken()).preload("u", "draft")  # nothing raised
        with self.assertRaises(GeminiError):
            Gemini("k", Broken())._check_budget(type("Ctx", (), {"user_id": "u", "feature": "draft", "account_id": None, "thread_id": None})())


if __name__ == "__main__":
    unittest.main()
