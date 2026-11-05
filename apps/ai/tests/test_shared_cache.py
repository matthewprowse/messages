"""Tests for the shared system prompt cache (gemini_shared_cache.py): made only once calls come often enough to pay for
it, used by the calls after, and dropped for the text when Gemini refuses it."""

import json
import time
import unittest
from unittest import mock

from ai.gemini import Gemini, UsageContext
from ai.gemini_shared_cache import MIN_CHARS, min_calls_per_hour
from ai.http import Response

MODEL = "gemini-3.5-flash-lite"
SYSTEM = "Sort the mail. " * (MIN_CHARS // 10)
ANSWER = {"candidates": [{"content": {"parts": [{"text": '{"ok": true}'}]}}], "usageMetadata": {"promptTokenCount": 1700, "candidatesTokenCount": 10}}


class Db:
    def __init__(self):
        self.usage: list[dict] = []

    def select(self, table, params):
        return []

    def first(self, table, params):
        return None

    def rpc(self, function, args):
        if function == "ai_allowance_for":
            return {"features": {"triage": 1.0}, "week_features": {}}
        if function == "analytics_owner_id":
            return "owner"
        return {}

    def insert(self, table, row, **kw):
        if table == "ai_usage":
            self.usage.append(row)


class Google:
    """Gemini's REST API: records the calls, makes caches, and refuses a call for a cache in refuse."""

    def __init__(self):
        self.calls: list[tuple[str, str, dict]] = []
        self.refuse: set[str] = set()
        self.made = 0

    def __call__(self, method, url, body=None, headers=None, timeout=30):
        sent = json.loads(body) if body else {}
        self.calls.append((method, url, sent))
        if url.endswith("/cachedContents"):
            self.made += 1
            return Response(200, {}, json.dumps({"name": f"cachedContents/c{self.made}", "usageMetadata": {"totalTokenCount": 1620}}).encode())
        if method == "PATCH":
            return Response(200, {}, b"{}")
        if sent.get("cachedContent") in self.refuse:
            return Response(404, {}, b'{"error": {"status": "NOT_FOUND", "message": "cached content not found"}}')
        return Response(200, {}, json.dumps(ANSWER).encode())

    def asked(self) -> list[dict]:
        return [b for m, u, b in self.calls if u.endswith(":generateContent")]


def settle(gemini: Gemini) -> None:
    for _ in range(200):
        if not any(e["busy"] for e in gemini._shared_state()[1].values()):
            return
        time.sleep(0.01)


def call(gemini: Gemini) -> dict:
    return gemini.json(MODEL, SYSTEM, "one message", {"type": "object"}, UsageContext("u", "triage"), share_system=True)


class SharedCache(unittest.TestCase):
    def setUp(self):
        self.db, self.google = Db(), Google()
        self.gemini = Gemini("k", self.db)
        patcher = mock.patch("ai.gemini.POOL.request", side_effect=self.google)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.gemini.close)

    def test_the_break_even_is_a_few_calls_an_hour(self):
        need = min_calls_per_hour(MODEL)
        self.assertGreater(need, 3)
        self.assertLess(need, 12)
        self.assertIsNone(min_calls_per_hour("not-a-model"))

    def test_below_the_rate_the_text_is_sent_and_no_cache_made(self):
        call(self.gemini)
        settle(self.gemini)
        self.assertEqual(self.google.made, 0)
        [body] = self.google.asked()
        self.assertIn("systemInstruction", body)
        self.assertNotIn("cachedContent", body)

    def test_at_the_rate_a_cache_is_made_and_used_by_the_next_calls(self):
        need = int(min_calls_per_hour(MODEL)) + 1
        for _ in range(need):
            call(self.gemini)
            settle(self.gemini)
        self.assertEqual(self.google.made, 1)
        call(self.gemini)
        last = self.google.asked()[-1]
        self.assertEqual(last["cachedContent"], "cachedContents/c1")
        self.assertNotIn("systemInstruction", last)
        self.gemini.close()
        made = [r for r in self.db.usage if r.get("user_id") == "owner"]
        self.assertTrue(made)  # the cache's tokens and storage are Konva's, not the person's whose call made it

    def test_a_refused_cache_is_dropped_and_the_call_sent_with_the_text(self):
        for _ in range(int(min_calls_per_hour(MODEL)) + 1):
            call(self.gemini)
            settle(self.gemini)
        self.google.refuse.add("cachedContents/c1")
        self.assertEqual(call(self.gemini), {"ok": True})
        refused, again = self.google.asked()[-2:]
        self.assertEqual(refused["cachedContent"], "cachedContents/c1")
        self.assertIn("systemInstruction", again)
        self.assertNotIn("cachedContent", again)

    def test_a_short_system_prompt_is_never_cached(self):
        for _ in range(30):
            self.gemini.json(MODEL, "short", "p", {"type": "object"}, UsageContext("u", "triage"), share_system=True)
        settle(self.gemini)
        self.assertEqual(self.google.made, 0)


if __name__ == "__main__":
    unittest.main()
