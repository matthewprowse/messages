"""Instagram on Meta's webhooks: the reply window rule (24 hours, 7 days with the HUMAN_AGENT tag), the tag on the
wire, and the hints the web app's webhook leaves for the connector. No network and no database."""

import json
import os
import unittest
import urllib.request
from datetime import datetime, timedelta, timezone

from ai.connectors.instagram import hints
from ai.connectors.instagram.graph import Graph
from ai.connectors.instagram.official import OUTSIDE_WINDOW, window_open
from ai.connectors.instagram.store import Store
from ai.connectors.instagram.window import CLOSED, OPEN, TAGGED, reply_mode
from tests.test_instagram_official import ANA, ME, FakeGraph, OfficialStore, official, outbox_row

NOW = datetime(2026, 11, 20, 12, 0, tzinfo=timezone.utc)


class Mode(unittest.TestCase):
    def test_standard_within_24_hours_whatever_human_agent_says(self):
        for human in (False, True):
            self.assertEqual(reply_mode(NOW - timedelta(hours=23, minutes=59), NOW, human), OPEN)

    def test_human_agent_extends_to_7_days_only_when_granted(self):
        self.assertEqual(reply_mode(NOW - timedelta(hours=24), NOW, True), TAGGED)
        self.assertEqual(reply_mode(NOW - timedelta(days=6, hours=23), NOW, True), TAGGED)
        self.assertEqual(reply_mode(NOW - timedelta(hours=24), NOW, False), CLOSED)
        self.assertEqual(reply_mode(NOW - timedelta(days=3), NOW, False), CLOSED)

    def test_closed_after_7_days_or_with_no_message_from_them(self):
        self.assertEqual(reply_mode(NOW - timedelta(days=7), NOW, True), CLOSED)
        self.assertEqual(reply_mode(None, NOW, True), CLOSED)
        self.assertFalse(window_open(NOW - timedelta(days=8), NOW, True))
        self.assertTrue(window_open(NOW - timedelta(days=2), NOW, True))
        self.assertFalse(window_open(NOW - timedelta(days=2), NOW))


class Tag(unittest.TestCase):
    def body(self, **kwargs):
        seen = []

        def open_(request: urllib.request.Request):
            seen.append(json.loads(request.data))
            return 200, b'{"message_id":"m1"}'

        Graph("T", open_).send(ANA, "Hello", **kwargs)
        return seen[0]

    def test_a_plain_reply_has_no_tag(self):
        self.assertEqual(self.body(), {"recipient": {"id": ANA}, "message": {"text": "Hello"}})

    def test_a_human_agent_reply_carries_the_tag(self):
        self.assertEqual(
            self.body(human_agent=True),
            {"recipient": {"id": ANA}, "message": {"text": "Hello"}, "messaging_type": "MESSAGE_TAG", "tag": "HUMAN_AGENT"},
        )


class SendingByWindow(unittest.TestCase):
    def last(self, hours):
        return {"sent_at": (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat(), "sender_address": ANA}

    def run_send(self, hours, human_agent):
        store, graph = OfficialStore([outbox_row()], last=self.last(hours)), FakeGraph(send={"message_id": "mid1"})
        sync = official(store)
        sync.human_agent = human_agent
        sync.send_outbox(graph)
        return store, graph

    def test_inside_24_hours_is_untagged(self):
        _, graph = self.run_send(5, True)
        self.assertEqual(graph.sent, [(ANA, "See you at 10")])

    def test_day_three_is_tagged_when_granted(self):
        store, graph = self.run_send(72, True)
        self.assertEqual(graph.sent, [(ANA, "See you at 10", True)])
        self.assertEqual(store.settled, [("o1", "mid1")])

    def test_day_three_is_refused_before_sending_when_not_granted(self):
        store, graph = self.run_send(72, False)
        self.assertEqual((graph.sent, store.failed), ([], [("o1", OUTSIDE_WINDOW)]))

    def test_day_eight_is_refused_even_when_granted(self):
        store, graph = self.run_send(8 * 24, True)
        self.assertEqual((graph.sent, store.failed), ([], [("o1", OUTSIDE_WINDOW)]))


class HintStore(OfficialStore):
    def __init__(self, rows):
        super().__init__()
        self.rows, self.asked, self.pruned = rows, [], 0

    def take_hints(self, ig_user_id):
        self.asked.append(ig_user_id)
        rows, self.rows = self.rows, []
        return rows

    def prune_hints(self):
        self.pruned += 1


class Hints(unittest.TestCase):
    def test_only_real_news_is_worth_a_read(self):
        self.assertTrue(hints.has_news([{"kind": "message"}]))
        self.assertTrue(hints.has_news([{"kind": "seen"}, {"kind": "reaction"}]))
        self.assertFalse(hints.has_news([{"kind": "seen"}]))
        self.assertFalse(hints.has_news([]))

    def test_the_safety_poll_is_slow_and_slower_when_quiet(self):
        mid = lambda: 0.5
        self.assertEqual(hints.safety_wait(0, mid), 15 * 60)
        self.assertEqual(hints.safety_wait(3 * 3600, mid), 30 * 60)

    def test_flags_are_off_unless_set(self):
        for name, fn in (("INSTAGRAM_WEBHOOKS", hints.webhooks_on), ("INSTAGRAM_HUMAN_AGENT", hints.human_agent_on)):
            os.environ.pop(name, None)
            self.assertFalse(fn())
            os.environ[name] = "1"
            try:
                self.assertTrue(fn())
            finally:
                del os.environ[name]

    def test_the_connector_reads_news_for_its_own_account_only(self):
        store = HintStore([{"id": 1, "kind": "message"}])
        sync = official(store)
        self.assertTrue(sync.take_hints())
        self.assertEqual(store.asked, [ME])
        self.assertFalse(sync.take_hints())  # taken: nothing is read twice
        self.assertEqual(store.pruned, 1)  # pruned on the first look, then only every few hours
        self.assertFalse(official(HintStore([{"id": 2, "kind": "seen"}])).take_hints())

    def test_a_failing_hint_read_never_stops_the_connector(self):
        class Broken(OfficialStore):
            def take_hints(self, ig_user_id):
                raise RuntimeError("down")

        self.assertFalse(official(Broken()).take_hints())


class StoreHints(unittest.TestCase):
    def test_taken_hints_are_deleted_by_id(self):
        calls = []

        class Db:
            def select(self, table, params):
                calls.append(("select", table, params))
                return [{"id": 4, "kind": "message"}, {"id": 5, "kind": "seen"}]

            def delete(self, table, filters):
                calls.append(("delete", table, filters))

        store = Store.__new__(Store)
        store.db = Db()
        self.assertEqual([h["id"] for h in store.take_hints(ME)], [4, 5])
        self.assertEqual(calls[0][2]["ig_user_id"], f"eq.{ME}")
        self.assertEqual(calls[1], ("delete", "meta_webhook_hints", {"id": "in.(4,5)"}))

    def test_nothing_waiting_deletes_nothing(self):
        calls = []

        class Db:
            def select(self, table, params):
                return []

            def delete(self, table, filters):
                calls.append(filters)

        store = Store.__new__(Store)
        store.db = Db()
        self.assertEqual(store.take_hints(ME), [])
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
