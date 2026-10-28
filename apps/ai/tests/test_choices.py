"""Tests for reply choices in ai.triage (read_choices, results and the prompt) and the decision text that ai.drafts adds
after the tone: bad options are dropped, two are needed, and choices appear only while a reply is needed."""

import json
import unittest

from ai.drafts import build_prompt as draft_prompt
from ai.triage import NO_CHOICES, UserContext, apply_signals, read_choices, read_results, sent_label, triage_prompt

OPTIONS = [
    {"label": "Yes, Available", "decision": "I am free on Thursday at 15:00.", "kind": "accept"},
    {"label": "Not Available", "decision": "I can't make Thursday at 15:00.", "kind": "decline"},
    {"label": "Suggest Another Time", "decision": "Thursday at 15:00 does not suit me; I will suggest another time.", "kind": "other_time"},
]


class Choices(unittest.TestCase):
    def test_choices_keep_options_time_and_length(self):
        got = json.loads(read_choices({"choices": OPTIONS, "asked_time": "2026-10-29T15:00", "asked_minutes": 60}))
        self.assertEqual(got["asked"], "2026-10-29T15:00")
        self.assertEqual(got["minutes"], 60)
        self.assertEqual([o["kind"] for o in got["options"]], ["accept", "decline", "other_time"])

    def test_choices_drop_bad_options_and_need_two(self):
        self.assertEqual(read_choices({"choices": [OPTIONS[0]], "asked_time": "", "asked_minutes": 0}), NO_CHOICES)
        got = json.loads(read_choices({"choices": [*OPTIONS, OPTIONS[0], {"label": "", "decision": "x", "kind": "accept"},
                                                   {"label": "Odd", "decision": "y", "kind": "nonsense"}, "junk"],
                                       "asked_time": "Thursday", "asked_minutes": 99999}))
        self.assertEqual([o["label"] for o in got["options"]], ["Yes, Available", "Not Available", "Suggest Another Time", "Odd"])
        self.assertEqual(got["options"][3]["kind"], "answer")
        self.assertIsNone(got["asked"])
        self.assertIsNone(got["minutes"])

    def test_results_carry_choices(self):
        got = read_results({"results": [{"email": 1, "priority": "important", "category": "needs_reply", "junk": False, "needs_reply": True,
                                         "summary": "Sam asks to meet.", "choices": OPTIONS, "asked_time": "", "asked_minutes": 0}]}, 1)
        self.assertEqual(len(json.loads(got[1]["choices"])["options"]), 3)

    def test_choices_only_while_a_reply_is_needed(self):
        base = {"priority": "normal", "category": "needs_reply", "junk": False, "needs_reply": True, "summary": "x", "choices": read_choices({"choices": OPTIONS})}
        self.assertEqual(len(json.loads(apply_signals(base, "a@b.com", UserContext(), [])["choices"])["options"]), 3)
        self.assertIsNone(apply_signals({**base, "needs_reply": False}, "a@b.com", UserContext(), [])["choices"])
        self.assertIsNone(apply_signals(base, "a@b.com", UserContext(), ["junk"])["choices"])
        self.assertEqual(apply_signals({**base, "choices": None}, "a@b.com", UserContext(), [])["choices"], NO_CHOICES)

    def test_prompt_says_when_it_was_sent(self):
        self.assertEqual(sent_label("2026-10-27T13:05:00+00:00"), "Tuesday 27 October 2026, 13:05 UTC")
        self.assertEqual(sent_label(None), "unknown")
        self.assertEqual(sent_label("2026-10-27T13:05:00+00:00", "Africa/Johannesburg"), "Tuesday 27 October 2026, 15:05 SAST")
        self.assertEqual(sent_label("2026-10-27T13:05:00+00:00", "Not/AZone"), "Tuesday 27 October 2026, 13:05 UTC")
        email = {"name": "Sam", "sender": "sam@x.com", "relationship": "", "known": False, "bulk": False, "subject": "Viewing",
                 "sent": "2026-10-27T13:05:00Z", "body": "Are you free Thursday at 3?"}
        self.assertIn("Sent: Tuesday 27 October 2026, 13:05 UTC", triage_prompt(UserContext(), [email]))


class Decision(unittest.TestCase):
    def test_decision_comes_after_the_tone(self):
        p = draft_prompt(me="Matt", about="", rules=[], examples=[], recent=[], them="Sam", relationship="", style_note="",
                         conversation=[("Sam", "Free Thursday at 3?")], tone="shorter", instruction="Mention parking", decision="I am free on Thursday at 15:00.")
        self.assertLess(p.index("Tone:"), p.index("What they decided to say: I am free on Thursday at 15:00."))
        self.assertLess(p.index("What they decided to say"), p.index("Their instruction for this reply: Mention parking"))
        self.assertNotIn("What they decided", draft_prompt(me="", about="", rules=[], examples=[], recent=[], them="", relationship="", style_note="",
                                                           conversation=[], tone="default", instruction=None))
