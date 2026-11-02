"""Tests for the daily brief's version 2 sections (ai.brief): who is waiting on them with days, promises due today or late,
and tomorrow's first meeting with one prep fact. Pure helpers and the prompt; the model is never called."""

import re
import unittest
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from ai.brief import SYSTEM, build_prompt, first_meeting, prep_fact, promises_due, sections, waiting_on_them

NOW = datetime(2026, 11, 4, 6, 0, tzinfo=timezone.utc)
ZONE = ZoneInfo("Africa/Johannesburg")
TODAY = date(2026, 11, 4)


def thread(i, days, **kw):
    return {"id": i, "status": "inbox", "junk": False, "last_from_me": True, "channel": "email", "summary": "Sent the lease", "_who": f"Person {i}",
            "last_message_at": (NOW - timedelta(days=days)).isoformat(), "snoozed_until": None, **kw}


class Waiting(unittest.TestCase):
    def test_only_answers_the_ai_expects_after_two_days_longest_first(self):
        threads = [thread("a", 3), thread("b", 5), thread("c", 1), thread("d", 4), thread("e", 4, last_from_me=False), thread("f", 20), thread("g", 4, junk=True)]
        got = waiting_on_them(threads, {"a", "b", "c", "e", "f", "g"}, NOW)
        self.assertEqual([(t["id"], t["_days"]) for t in got], [("b", 5), ("a", 3)])  # d is not expected, c is too recent, f too old

    def test_a_snoozed_one_waits_for_its_time(self):
        ahead = (NOW + timedelta(hours=5)).isoformat()
        self.assertEqual(waiting_on_them([thread("a", 3, snoozed_until=ahead)], {"a"}, NOW), [])
        past = (NOW - timedelta(hours=5)).isoformat()
        self.assertEqual(len(waiting_on_them([thread("a", 3, snoozed_until=past)], {"a"}, NOW)), 1)

    def test_these_conversations_are_not_in_the_reply_sections(self):
        got = sections([thread("a", 3, needs_reply=True)], NOW)
        self.assertEqual((got["reply"], got["priority"], got["updates"]), ([], [], []))


def promise(thread_id="t1", due="2026-11-04", owner="me", **kw):
    return {"thread_id": thread_id, "owner": owner, "text": "Send the quote", "due_on": due, "status": "open", "snoozed_until": None, **kw}


class Promises(unittest.TestCase):
    def test_due_today_and_late_with_a_name_to_say_late_first(self):
        rows = [promise(due="2026-11-04"), promise(due="2026-11-02", owner="them"), promise(due="2026-11-05"), promise(thread_id="unknown"), promise(due=None)]
        got = promises_due(rows, TODAY, {"t1": "Sam Naidoo"})
        self.assertEqual([(r["_late"], r["owner"], r["_who"]) for r in got], [(2, "them", "Sam Naidoo"), (0, "me", "Sam Naidoo")])

    def test_one_snoozed_past_today_is_left_out(self):
        later = datetime(2026, 11, 5, 8, 0, tzinfo=timezone.utc).isoformat()
        self.assertEqual(promises_due([promise(snoozed_until=later)], TODAY, {"t1": "Sam"}), [])


def event(title, hour, **kw):
    return {"title": title, "starts_at": datetime(2026, 11, 5, hour, 0, tzinfo=timezone.utc).isoformat(), "all_day": False, "location": None, **kw}


class Tomorrow(unittest.TestCase):
    def test_the_first_timed_event_is_the_meeting(self):
        got = first_meeting([event("Later", 12), event("Holiday", 0, all_day=True), event("Early", 7), {"title": "No time", "all_day": False}])
        self.assertEqual(got["title"], "Early")
        self.assertIsNone(first_meeting([]))

    def test_the_prep_fact_is_an_open_promise_with_someone_named_in_the_title(self):
        who = {"t1": "Sam Naidoo", "t2": "Lerato"}
        rows = [promise(thread_id="t2", text="Sign the lease", owner="them"), promise(thread_id="t1", text="Send the quote")]
        self.assertEqual(prep_fact(event("Lunch with Sam Naidoo", 9), rows, who), "You promised: Send the quote")
        self.assertEqual(prep_fact(event("Call Lerato", 9), rows, who), "Lerato promised: Sign the lease")
        self.assertEqual(prep_fact(event("Team stand-up", 9), rows, who), "")
        self.assertEqual(prep_fact(None, rows, who), "")


def fenced_part(prompt):
    return re.search(r"<<<(UNTRUSTED-[0-9a-f]+)\n(.*?)\n\1>>>", prompt, re.S).group(2)


class Prompt(unittest.TestCase):
    def build(self, **kw):
        return build_prompt("Matt Prowse", TODAY, ZONE, [], {"reply": [], "priority": [], "updates": []}, NOW, None, **kw)

    def test_the_new_sections_sit_inside_the_fence_with_days_and_names(self):
        waiting = [{**thread("a", 3), "_days": 3, "_who": "Sam Naidoo"}]
        promises = [{"owner": "them", "text": "Confirm Monday", "_late": 2, "_who": "Lerato"}, {"owner": "me", "text": "Send the quote", "_late": 0, "_who": "Sam Naidoo"}]
        meeting = event("Lunch with Sam Naidoo", 7, location="Cafe Roux")
        p = self.build(waiting=waiting, promises=promises, tomorrow=meeting, prep="You promised: Send the quote")
        inside = fenced_part(p)
        self.assertIn("- Sam Naidoo (email, 3 days): Sent the lease", inside)
        self.assertIn("- They promised you (Lerato), due 2 days ago: Confirm Monday", inside)
        self.assertIn("- You promised (Sam Naidoo), due today: Send the quote", inside)
        self.assertIn("09:00: Lunch with Sam Naidoo, at Cafe Roux", inside)  # 07:00 UTC is 09:00 in Johannesburg
        self.assertIn("- Prep fact: You promised: Send the quote", inside)

    def test_without_the_new_data_they_read_as_none_and_no_meeting_is_invented(self):
        inside = fenced_part(self.build())
        self.assertIn("Waiting on them (you wrote last, no answer yet):\n(none)", inside)
        self.assertIn("Promises due today or late:\n(none)", inside)
        self.assertNotIn("Tomorrow's first meeting", inside)

    def test_the_instructions_keep_the_length_budget_and_drop_the_new_lines_first(self):
        self.assertIn("80 to 160 words", SYSTEM)
        self.assertIn("first to drop", SYSTEM)

    def test_at_most_three_waiting_and_four_promises_are_listed(self):
        waiting = [{**thread(str(i), 3), "_days": 3} for i in range(6)]
        promises = [{"owner": "me", "text": f"Do {i}", "_late": 0, "_who": "Sam"} for i in range(7)]
        inside = fenced_part(self.build(waiting=waiting, promises=promises))
        self.assertEqual(inside.count("(email, 3 days)"), 3)
        self.assertEqual(inside.count("You promised (Sam)"), 4)


if __name__ == "__main__":
    unittest.main()
