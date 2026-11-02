"""Tests for ai/triage_extras.py and how triage uses it: reasons, the suspicious flag, Auto labels and the junk summary."""

import unittest

from ai.triage import SCHEMA, SYSTEM, apply_signals, known_outcome, read_results, triage_prompt
from ai.triage_extras import AutoLabel, label_to_add, read_label, read_reason, read_suspicious, with_subject_summary
from ai.triage_signals import UserContext

LABELS = [AutoLabel("l1", "Active Deals", "Clients with a live deal"), AutoLabel("l2", "Tenants", "")]


def item(**kw):
    base = {"email": 1, "priority": "normal", "category": "fyi", "junk": False, "needs_reply": False, "summary": "S", "choices": []}
    return {**base, **kw}


class ReasonTests(unittest.TestCase):
    def test_an_unknown_code_becomes_other_and_words_are_cut_to_one_line(self):
        code, words = read_reason({"reason": "made_up", "reason_text": "  a\nb  " + "x" * 100})
        self.assertEqual(code, "other")
        self.assertEqual(len(words), 60)
        self.assertTrue(words.startswith("a b"))

    def test_missing_words_fall_back_to_the_codes_phrase(self):
        self.assertEqual(read_reason({"reason": "newsletter"}), ("newsletter", "Newsletter"))

    def test_a_rule_overrides_the_model_reason_with_fixed_words(self):
        ctx = UserContext(always=["boss@x.com"])
        out = apply_signals({**item(), "reason_code": "personal", "reason_text": "A person"}, "boss@x.com", ctx, [])
        self.assertEqual(out["reason_code"], "rule_always")
        self.assertEqual(out["reason_text"], "Marked always important by you")

    def test_the_model_reason_stands_when_no_signal_applies(self):
        out = apply_signals({**item(), "reason_code": "asked_you", "reason_text": "You asked a question"}, "a@b.com", UserContext(), [])
        self.assertEqual((out["reason_code"], out["reason_text"]), ("asked_you", "You asked a question"))

    def test_no_reply_needed_feedback_clears_needs_reply(self):
        out = apply_signals(item(needs_reply=True, choices="{}"), "a@b.com", UserContext(), ["no_reply_needed"])
        self.assertFalse(out["needs_reply"])
        self.assertEqual(out["reason_code"], "no_reply_needed")
        self.assertIsNone(out["choices"])

    def test_settled_outcomes_carry_a_reason(self):
        got = known_outcome({"sender_address": "a@b.com", "subject": "Hi"}, UserContext(unsubscribed={"a@b.com"}), [])
        self.assertEqual(got["reason_code"], "unsubscribed")
        got = known_outcome({"sender_address": "c@d.com", "subject": "Hi"}, UserContext(), ["junk"])
        self.assertEqual(got["reason_code"], "marked_junk")


class SuspiciousTests(unittest.TestCase):
    def test_only_known_kinds_count(self):
        self.assertEqual(read_suspicious({"suspicious": "payment_change"}), "payment_change")
        self.assertIsNone(read_suspicious({"suspicious": "none"}))
        self.assertIsNone(read_suspicious({"suspicious": "yes please act"}))

    def test_it_is_read_with_the_result(self):
        got = read_results({"results": [item(suspicious="phishing", reason="security", reason_text="Asks for a login")]}, 1)
        self.assertEqual(got[1]["suspicious"], "phishing")
        self.assertEqual(got[1]["reason_code"], "security")


class AutoLabelTests(unittest.TestCase):
    def test_the_model_answers_with_a_number_we_offered(self):
        self.assertEqual(read_label({"label": "2"}, 2), 2)
        self.assertIsNone(read_label({"label": "3"}, 2))
        self.assertIsNone(read_label({"label": "none"}, 2))
        self.assertIsNone(read_label({"label": "Active Deals"}, 2))

    def test_no_labels_offered_means_no_pick(self):
        self.assertIsNone(read_results({"results": [item(label="1")]}, 1)[1]["label_index"])
        self.assertEqual(read_results({"results": [item(label="1")]}, 1, 2)[1]["label_index"], 1)

    def test_a_label_is_added_once_and_never_after_it_was_taken_off(self):
        self.assertEqual(label_to_add(LABELS, 1, set(), set()), "l1")
        self.assertIsNone(label_to_add(LABELS, 1, set(), {"l1"}))

    def test_at_most_one_auto_label_per_conversation(self):
        self.assertIsNone(label_to_add(LABELS, 2, {"l1"}, set()))
        self.assertEqual(label_to_add(LABELS, 2, {"other"}, set()), "l2")

    def test_the_prompt_lists_labels_between_marked_lines(self):
        prompt = triage_prompt(UserContext(auto_labels=LABELS), [], fence="F")
        self.assertIn("1. Active Deals: Clients with a live deal", prompt)
        self.assertIn("2. Tenants", prompt)
        self.assertIn("UNTRUSTED-", prompt)
        self.assertIn("auto labels: none", triage_prompt(UserContext(), [], fence="F"))

    def test_the_schema_asks_for_the_extras(self):
        required = SCHEMA["properties"]["results"]["items"]["required"]
        for key in ("reason", "reason_text", "suspicious", "label"):
            self.assertIn(key, required)


class CostTests(unittest.TestCase):
    def test_junk_keeps_no_model_summary_and_the_subject_stands_in(self):
        got = read_results({"results": [item(junk=True, summary="Long marketing blurb")]}, 1)[1]
        self.assertEqual(got["summary"], "")
        self.assertEqual(with_subject_summary(got, "50% Off Today")["summary"], "50% Off Today")

    def test_a_real_summary_is_kept(self):
        self.assertEqual(with_subject_summary({"summary": "Cindy wants a call"}, "Subject")["summary"], "Cindy wants a call")

    def test_choices_are_only_for_times_and_decisions(self):
        self.assertIn("asks about a time", SYSTEM)
        self.assertIn("Never for an open question", SYSTEM)


if __name__ == "__main__":
    unittest.main()
