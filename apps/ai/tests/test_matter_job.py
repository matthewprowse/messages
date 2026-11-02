"""Tests for picking whose conversations the Same Matter job scores, and the channel learned rules belong to."""

import unittest

from ai.learn import rule_channel
from ai.matter_job import recent_users


class RecentUsersTest(unittest.TestCase):
    def test_distinct_in_order_and_capped(self):
        rows = [{"user_id": "a"}, {"user_id": "b"}, {"user_id": "a"}, {"user_id": None}, {"user_id": "c"}]
        self.assertEqual(recent_users(rows), ["a", "b", "c"])
        self.assertEqual(recent_users(rows, limit=2), ["a", "b"])

    def test_empty(self):
        self.assertEqual(recent_users([]), [])


class RuleChannelTest(unittest.TestCase):
    def test_whatsapp_kept_apart(self):
        self.assertEqual(rule_channel("whatsapp"), "whatsapp")
        self.assertEqual(rule_channel("email"), "email")
        self.assertEqual(rule_channel(None), "email")


if __name__ == "__main__":
    unittest.main()
