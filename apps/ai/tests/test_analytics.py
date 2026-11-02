"""Tests for ai.analytics: only code words and small numbers become event properties, traits and buckets hold no text,
and a Gemini call leaves one content-free event (with a failure code when it fails) and never raises."""

import time
import unittest

from ai.analytics import Analytics, event, length_bucket, hour_bucket, prompt_id, sender_kind, traits, word
from ai.gemini import Gemini, GeminiError, UsageContext


class Words(unittest.TestCase):
    def test_only_code_words_pass(self):
        self.assertEqual(word("newsletter"), "newsletter")
        self.assertEqual(word("gemini-3-flash"), "gemini-3-flash")
        for text in ["Alice Smith", "alice smith", "a@b.com", "27821234567", "", None, 5]:
            self.assertIsNone(word(text))

    def test_events_drop_text_and_big_numbers(self):
        e = event("x", ok=True, ms=12.4, phone=27821234567, who="Alice Smith", kind="accept", kinds=["a", "B c"], nothing=None)
        self.assertEqual(e, {"name": "x", "props": {"ok": True, "ms": 12.4, "kind": "accept", "kinds": ["a"]}})

    def test_prompt_code_changes_with_the_instructions(self):
        self.assertEqual(prompt_id("a"), prompt_id("a"))
        self.assertNotEqual(prompt_id("a"), prompt_id("b"))
        self.assertRegex(prompt_id("a"), r"^p[0-9a-f]{7}$")


class Traits(unittest.TestCase):
    def test_buckets(self):
        self.assertEqual([length_bucket(n) for n in (None, 10, 500, 5000)], ["unknown", "short", "medium", "long"])
        self.assertEqual(hour_bucket("2026-10-26T23:30:00Z", "Africa/Johannesburg"), "night")  # 01:30 there
        self.assertEqual(hour_bucket("2026-10-26T10:00:00Z", "Africa/Johannesburg"), "afternoon")
        self.assertEqual(hour_bucket("nonsense", None), "unknown")

    def test_sender_kinds(self):
        self.assertEqual(sender_kind("sam@example.com", False, False), "person")
        self.assertEqual(sender_kind("noreply@bank.com", False, False), "company")
        self.assertEqual(sender_kind("no-reply123@bank.com", False, False), "company")
        self.assertEqual(sender_kind("deals@shop.com", True, False), "bulk")
        self.assertEqual(sender_kind("", False, True), "group")

    def test_traits_hold_no_text(self):
        m = {"sender_address": "Info@Shop.com", "list_unsubscribe": "<mailto:x>", "sent_at": "2026-10-26T10:00:00Z", "attachments": [{"filename": "invoice.pdf"}], "threads": {"channel": "email"}, "subject": "Your order"}
        t = traits(m, "model", chars=900, known=False, timezone="UTC")
        self.assertEqual(t, {"channel": "email", "sender": "bulk", "bulk": True, "attach": True, "len": "medium", "hour": "morning", "known": False, "source": "model"})
        self.assertTrue(all(isinstance(v, (bool, str)) for v in t.values()))


class FakeDb:
    def __init__(self):
        self.calls = []

    def insert(self, table, row):
        return []

    def rpc(self, function, args):
        if function in ("ai_allowance_for", "ai_setup_state"):  # the budget checks, not analytics writes
            return {"features": {"triage": 0, "draft": 0, "learn": 0, "brief": 0, "transcribe": 0, "bulk_read": 0}}
        if function == "ai_allowance_shares_for":  # dollars per share are optional; none means only percentages are checked
            return None
        self.calls.append((function, args))


class Recording(Gemini):
    def __init__(self, db, fail=None):
        super().__init__("key", db)
        self.fail = fail

    def _call(self, model, body, endpoint="", *, attempts=4, timeout=90, stats=None):
        if stats is not None:
            stats["attempts"] = 2
        if self.fail:
            raise self.fail
        return {"candidates": [{"content": {"parts": [{"text": '{"ok": true}'}]}}], "usageMetadata": {"promptTokenCount": 1000, "cachedContentTokenCount": 500, "candidatesTokenCount": 50}}


def wait_for(db, n=1):
    for _ in range(100):
        if len(db.calls) >= n:
            return
        time.sleep(0.01)


class AiCallEvents(unittest.TestCase):
    def test_a_call_leaves_one_event_without_content(self):
        db = FakeDb()
        Recording(db).json("gemini-3-flash", "instructions", "an email about Alice", {}, UsageContext("u1", "triage"))
        wait_for(db)
        function, args = db.calls[0]
        self.assertEqual((function, args["p_user"]), ("analytics_record", "u1"))
        props = args["p_events"][0]["props"]
        self.assertEqual(args["p_events"][0]["name"], "ai_call")
        self.assertEqual((props["feature"], props["model"], props["ok"], props["attempts"]), ("triage", "gemini-3-flash", True, 2))
        self.assertEqual((props["in_tok"], props["out_tok"], props["cached_pct"]), (1000, 50, 50))
        self.assertEqual(props["prompt"], prompt_id("instructions"))
        self.assertNotIn("Alice", str(args))

    def test_a_failed_call_says_why_by_code(self):
        db = FakeDb()
        with self.assertRaises(GeminiError):
            Recording(db, GeminiError(429, "RESOURCE_EXHAUSTED")).json("m", "s", "p", {}, UsageContext("u1", "draft"))
        wait_for(db)
        props = db.calls[0][1]["p_events"][0]["props"]
        self.assertEqual((props["ok"], props["code"], props["feature"]), (False, "http_429", "draft"))

    def test_analytics_never_raises(self):
        class Broken:
            def rpc(self, function, args):
                raise RuntimeError("down")

        a = Analytics(Broken())
        a.emit("u1", [event("x")])
        a._pool.shutdown(wait=True)


if __name__ == "__main__":
    unittest.main()
