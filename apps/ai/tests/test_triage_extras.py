"""Tests for ai/triage_extras.py and how triage uses it: signals, the suspicious flag,
Auto labels, the junk summary, what counts as urgent and that chats are not called emails."""

import unittest

from ai.triage import SCHEMA, SYSTEM, apply_signals, known_outcome, read_results, triage_prompt
from ai.triage_extras import AutoLabel, label_to_add, read_label, read_suspicious, with_subject_summary
from ai.triage_signals import UserContext

LABELS = [AutoLabel("l1", "Active Deals", "Clients with a live deal"), AutoLabel("l2", "Tenants", "")]


def item(**kw):
    base = {"email": 1, "priority": "normal", "category": "fyi", "junk": False, "needs_reply": False, "summary": "S", "choices": []}
    return {**base, **kw}


class SignalTests(unittest.TestCase):
    def test_no_reply_needed_feedback_clears_needs_reply(self):
        out = apply_signals(item(needs_reply=True, choices="{}"), "a@b.com", UserContext(), ["no_reply_needed"])
        self.assertFalse(out["needs_reply"])
        self.assertIsNone(out["choices"])

    def test_reasons_are_no_longer_asked_for_or_written(self):
        # The "why" popover was removed (3 Nov 2026): the model is not asked for a reason and none is stored.
        self.assertNotIn("reason", SCHEMA["properties"]["results"]["items"]["properties"])
        self.assertNotIn("reason_code", read_results({"results": [item(priority="urgent")]}, 1)[1])
        self.assertNotIn("reason_code", known_outcome({"sender_address": "a@b.com", "subject": "Hi"}, UserContext(unsubscribed={"a@b.com"}), []))


class UrgentAndChannelTests(unittest.TestCase):
    def test_urgent_is_for_today_and_a_waiting_person_is_not_urgent(self):
        self.assertIn("explicit deadline today", SYSTEM)
        self.assertIn("A person waiting on a reply, even one chasing, is important and needs_reply, not urgent", SYSTEM)
        self.assertNotIn("a person waiting on them now", SYSTEM)

    def test_chats_are_named_as_chats_not_emails(self):
        chat = {"name": "Sam", "sender": "+27", "relationship": "", "known": True, "bulk": False, "subject": "", "body": "Hi", "channel": "whatsapp"}
        prompt = triage_prompt(UserContext(), [chat, {**chat, "channel": None}], fence="F")
        self.assertIn("=== Message 1\nChannel: WhatsApp chat", prompt)
        self.assertIn("=== Message 2\nChannel: Email", prompt)
        self.assertNotIn("=== Email", prompt)
        self.assertTrue(SYSTEM.startswith("You sort one person's incoming messages."))

    def test_answers_are_numbered_by_message_and_old_email_numbers_still_read(self):
        self.assertEqual(SCHEMA["properties"]["results"]["items"]["required"][0], "message")
        self.assertEqual(sorted(read_results({"results": [item(), {**item(), "email": None, "message": 2}]}, 2)), [1, 2])


class SuspiciousTests(unittest.TestCase):
    def test_only_known_kinds_count(self):
        self.assertEqual(read_suspicious({"suspicious": "payment_change"}), "payment_change")
        self.assertIsNone(read_suspicious({"suspicious": "none"}))
        self.assertIsNone(read_suspicious({"suspicious": "yes please act"}))

    def test_it_is_read_with_the_result(self):
        got = read_results({"results": [item(suspicious="phishing")]}, 1)
        self.assertEqual(got[1]["suspicious"], "phishing")


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
        for key in ("suspicious", "label"):
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
