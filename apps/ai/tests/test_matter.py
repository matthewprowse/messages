"""Tests for ai.matter: which email and chat pairs are suggested as the same matter, which are left to the model, and that
suggest() writes new pairs only, never over an existing (for example dismissed) one."""

import unittest
from array import array
from datetime import datetime, timedelta, timezone

from ai.matter import CHECK_AT, MatterThread, Pair, build_threads, find_pairs, mean_vector, score_pair, suggest
from ai.similar import unit

T0 = datetime(2026, 11, 1, tzinfo=timezone.utc)


def v(*head: float) -> array:
    return unit(list(head) + [0.0] * (4 - len(head)))


def th(tid, channel, vec, days=0.0, contact="c1"):
    return MatterThread(tid, channel, contact, T0 + timedelta(days=days), vec)


class Scoring(unittest.TestCase):
    def test_same_direction_on_two_channels_is_suggested_outright(self):
        p = score_pair(th("b", "email", v(1, 0)), th("a", "whatsapp", v(1, 0.1), 1))
        self.assertIsNotNone(p)
        self.assertEqual((p.a, p.b), ("a", "b"))  # ordered whichever way round they are given
        self.assertFalse(p.borderline)

    def test_a_middling_score_is_borderline_and_a_low_one_is_dropped(self):
        mid = v(1, 0.95)  # cosine about 0.72 with (1, 0)
        self.assertTrue(score_pair(th("a", "email", v(1, 0)), th("b", "whatsapp", mid, 5)).borderline)
        self.assertIsNone(score_pair(th("a", "email", v(1, 0)), th("b", "whatsapp", v(0, 1), 5)))

    def test_being_close_in_time_lowers_the_bar_a_little(self):
        just_under = v(1, 1.1)  # cosine about 0.67: under CHECK_AT alone
        self.assertLess(float(sum(x * y for x, y in zip(v(1, 0), just_under))), CHECK_AT)
        self.assertIsNone(score_pair(th("a", "email", v(1, 0)), th("b", "whatsapp", just_under, 6)))
        self.assertIsNotNone(score_pair(th("a", "email", v(1, 0)), th("b", "whatsapp", just_under, 1)))

    def test_same_channel_other_person_far_apart_group_and_no_vector_are_never_paired(self):
        base = th("a", "email", v(1, 0))
        self.assertIsNone(score_pair(base, th("b", "email", v(1, 0))))
        self.assertIsNone(score_pair(base, th("b", "whatsapp", v(1, 0), contact="c2")))
        self.assertIsNone(score_pair(base, th("b", "whatsapp", v(1, 0), days=30)))
        self.assertIsNone(score_pair(base, th("b", "whatsapp", v(1, 0), contact=None)))
        self.assertIsNone(score_pair(base, th("b", "whatsapp", None)))

    def test_find_pairs_puts_the_most_similar_first(self):
        out = find_pairs([th("e", "email", v(1, 0)), th("w1", "whatsapp", v(1, 0.95), 1), th("w2", "whatsapp", v(1, 0.05), 1)])
        self.assertEqual([p.b if p.a == "e" else p.a for p in out], ["w2", "w1"])

    def test_mean_vector_is_a_unit_and_empty_or_cancelling_is_none(self):
        m = mean_vector([v(1, 0), v(0, 1)])
        self.assertAlmostEqual(sum(x * x for x in m), 1.0, places=5)
        self.assertIsNone(mean_vector([]))
        self.assertIsNone(mean_vector([v(1, 0), v(-1, 0)]))

    def test_build_threads_takes_the_contact_of_one_to_one_threads_only(self):
        rows = [
            {"id": "a", "channel": "email", "is_group": False, "last_message_at": "2026-11-01T10:00:00Z"},
            {"id": "g", "channel": "whatsapp", "is_group": True, "last_message_at": "2026-11-01T10:00:00Z"},
            {"id": "n", "channel": "email", "is_group": False, "last_message_at": None},
        ]
        out = build_threads(rows, {"a": ["c1"], "g": ["c1"], "n": ["c1"]}, {"a": [v(1, 0)]})
        self.assertEqual([(t.id, t.contact) for t in out], [("a", "c1"), ("g", None)])


class Db:
    def __init__(self, links=()):
        self.links = list(links)
        self.inserted = []

    def select(self, table, params):
        if table == "threads":
            return [
                {"id": "e", "channel": "email", "is_group": False, "last_message_at": "2026-11-01T10:00:00Z"},
                {"id": "w", "channel": "whatsapp", "is_group": False, "last_message_at": "2026-11-02T10:00:00Z"},
                {"id": "x", "channel": "linkedin", "is_group": False, "last_message_at": "2026-11-02T10:00:00Z"},
            ]
        if table == "thread_participants":
            return [{"thread_id": "e", "contact_id": "c1"}, {"thread_id": "w", "contact_id": "c1"}, {"thread_id": "x", "contact_id": "c1"}]
        return list(self.links)

    def insert_new(self, table, row, on_conflict):
        self.inserted.append(row)
        return [row]


class Index:
    def __init__(self, items):
        self._items = items

    def items(self, user_id):
        return self._items


ITEMS = [("m1", "e", v(1, 0)), ("m2", "w", v(1, 0.1)), ("m3", "x", v(1, 0.95))]


class Suggest(unittest.TestCase):
    def test_a_clear_pair_is_written_and_a_borderline_one_waits_for_the_model(self):
        db = Db()
        self.assertEqual(suggest(db, Index(ITEMS), "u"), 2)  # no confirm: e/x is borderline and skipped
        self.assertEqual((db.inserted[0]["thread_a"], db.inserted[0]["thread_b"], db.inserted[0]["source"]), ("e", "w", "similarity"))
        self.assertEqual(len(db.inserted), 2)

    def test_a_confirmed_borderline_pair_is_written_as_ai_and_a_refused_one_is_not(self):
        asked = []
        db = Db()
        self.assertEqual(suggest(db, Index(ITEMS), "u", lambda p: asked.append(p) or True), 3)
        self.assertEqual(len(asked), 1)  # only e/x is borderline
        self.assertIn("ai", [r["source"] for r in db.inserted])
        db = Db()
        self.assertEqual(suggest(db, Index(ITEMS), "u", lambda p: False), 2)

    def test_a_pair_with_a_row_already_is_left_alone_and_the_model_is_not_asked(self):
        db = Db([{"thread_a": "e", "thread_b": "w"}, {"thread_a": "e", "thread_b": "x"}, {"thread_a": "w", "thread_b": "x"}])
        asked = []
        self.assertEqual(suggest(db, Index(ITEMS), "u", lambda p: asked.append(p) or True), 0)
        self.assertEqual((db.inserted, asked), ([], []))

    def test_the_model_is_asked_at_most_max_asked_times(self):
        asked = []
        suggest(Db(), Index(ITEMS), "u", lambda p: asked.append(p) or True, max_asked=0)
        self.assertEqual(asked, [])


if __name__ == "__main__":
    unittest.main()
