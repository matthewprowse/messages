"""The owner's kill switches (ai.flags): who a switch applies to, the cache, a failed read leaving everything on, and the three
choke points: the Gemini budget check, pre-drafts and the Instagram connector. Also the unpriced-model write for Admin."""

import unittest

from ai.billing import persist_unpriced
from ai.flags import Flags, flag_applies, flags_for
from ai.gemini import Gemini, GeminiError, UsageContext


class FlagDb:
    """Serves feature_flags rows; answers the budget RPCs so a call that is not switched off goes ahead."""

    def __init__(self, rows=None, fail=False):
        self.rows = rows or []
        self.fail = fail
        self.reads = 0
        self.upserts = []

    def select(self, table, params):
        assert table == "feature_flags"
        self.reads += 1
        if self.fail:
            raise RuntimeError("no such table")
        return self.rows

    def rpc(self, function, args):
        if function == "ai_setup_state":
            return {"accounts": 0, "allowance": 0, "spent": 0}
        if function == "ai_allowance_shares_for":
            raise RuntimeError("no such function")
        return {"features": {"draft": 1, "documents": 1, "automations": 1, "triage": 1, "logos": 1}, "week_features": {}}

    def upsert(self, table, rows, on_conflict):
        self.upserts.append((table, rows, on_conflict))


def row(key, enabled=True, users=None):
    return {"key": key, "enabled": enabled, "user_ids": users or []}


class Clock:
    now = 0.0

    def __call__(self):
        return self.now


class FlagsTest(unittest.TestCase):
    def test_a_switch_applies_to_everyone_or_to_the_people_listed(self):
        self.assertFalse(flag_applies(None, "u"))
        self.assertFalse(flag_applies(row("k", False), "u"))
        self.assertTrue(flag_applies(row("k"), "u"))
        self.assertTrue(flag_applies(row("k"), None))
        self.assertTrue(flag_applies(row("k", True, ["u1"]), "u1"))
        self.assertFalse(flag_applies(row("k", True, ["u1"]), "u2"))
        self.assertFalse(flag_applies(row("k", True, ["u1"]), None))

    def test_rows_are_cached_then_read_again(self):
        clock = Clock()
        db = FlagDb([row("pause_all_ai")])
        flags = Flags(db, cache_s=10, clock=clock)
        self.assertTrue(flags.is_on("pause_all_ai", "u"))
        clock.now = 9
        flags.is_on("pause_all_ai", "u")
        self.assertEqual(db.reads, 1)
        clock.now = 10
        flags.is_on("pause_all_ai", "u")
        self.assertEqual(db.reads, 2)

    def test_a_failed_read_keeps_the_last_rows_and_never_raises(self):
        clock = Clock()
        db = FlagDb([row("disable_sends")])
        flags = Flags(db, cache_s=1, clock=clock)
        self.assertTrue(flags.is_on("disable_sends"))
        db.fail = True
        clock.now = 5
        self.assertTrue(flags.is_on("disable_sends"))

    def test_before_any_read_works_every_switch_is_off(self):
        self.assertFalse(Flags(FlagDb(fail=True)).is_on("pause_all_ai", "u"))

    def test_features_have_their_own_switches_and_pause_all_covers_them_all(self):
        flags = Flags(FlagDb([row("pause_documents")]))
        self.assertTrue(flags.blocks_feature("documents", "u"))
        self.assertFalse(flags.blocks_feature("draft", "u"))
        everything = Flags(FlagDb([row("pause_all_ai")]))
        for feature in ("draft", "triage", "documents", "automations", "logos"):
            self.assertTrue(everything.blocks_feature(feature, "u"))

    def test_one_reader_is_shared_per_database(self):
        db = FlagDb()
        self.assertIs(flags_for(db), flags_for(db))


class ChokePointTest(unittest.TestCase):
    def test_the_budget_check_refuses_every_feature_when_all_ai_is_paused(self):
        g = Gemini("key", FlagDb([row("pause_all_ai")]))
        for feature in ("draft", "triage", "logos"):
            with self.assertRaises(GeminiError) as caught:
                g._check_budget(UsageContext("u", feature))
            self.assertIsNone(caught.exception.status)

    def test_the_budget_check_refuses_only_the_paused_feature(self):
        g = Gemini("key", FlagDb([row("pause_automations")]))
        with self.assertRaises(GeminiError):
            g._check_budget(UsageContext("u", "automations"))
        g._check_budget(UsageContext("u", "draft"))

    def test_a_switch_limited_to_one_person_leaves_others_alone(self):
        g = Gemini("key", FlagDb([row("pause_all_ai", True, ["u1"])]))
        with self.assertRaises(GeminiError):
            g._check_budget(UsageContext("u1", "draft"))
        g._check_budget(UsageContext("u2", "draft"))

    def test_nothing_is_switched_off_when_the_table_cannot_be_read(self):
        g = Gemini("key", FlagDb(fail=True))
        g._check_budget(UsageContext("u", "draft"))

    def test_pre_drafts_expire_when_their_switch_is_thrown(self):
        from ai.drafts_gather import GatherMixin

        class Gather(GatherMixin):
            def __init__(self, db):
                self.db = db
                self.expired = []
                self.gemini = object()

            def _expire(self, d):
                self.expired.append(d["id"])

        g = Gather(FlagDb([row("pause_predrafts")]))
        self.assertTrue(g._limited({"id": "d1", "user_id": "u", "thread_id": "t", "auto": True}))
        self.assertEqual(g.expired, ["d1"])

    def test_instagram_accounts_are_halted_by_their_switch(self):
        from ai.connectors.instagram.run import Accounts

        class Store:
            def __init__(self, db):
                self.db = db

        on = Accounts(Store(FlagDb([row("disable_connector_instagram")])), settings=None)
        off = Accounts(Store(FlagDb()), settings=None)
        self.assertTrue(on.switched_off({"user_id": "u"}))
        self.assertFalse(off.switched_off({"user_id": "u"}))


class UnpricedTest(unittest.TestCase):
    def test_models_without_a_price_are_written_for_admin(self):
        db = FlagDb()
        persist_unpriced(db, ["b", "a", "b"])
        table, body, conflict = db.upserts[0]
        self.assertEqual((table, conflict, body["unpriced_models"]), ("ai_status", "id", ["a", "b"]))

    def test_a_failed_write_does_not_stop_the_worker(self):
        class Broken:
            def upsert(self, *a, **k):
                raise RuntimeError("down")

        persist_unpriced(Broken(), ["x"])


if __name__ == "__main__":
    unittest.main()
