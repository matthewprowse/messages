import base64
import unittest
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from ai.brief import Brief, build_prompt, due_today, sections, wav_seconds, zone_of
from ai.gemini import pcm_to_wav
from ai.signals import build_prompt as signals_prompt

NOW = datetime(2026, 10, 23, 6, 30, tzinfo=timezone.utc)  # 08:30 in Johannesburg


def thread(i, hours, **kw):
    return {"id": str(i), "status": "inbox", "junk": False, "last_message_at": (NOW - timedelta(hours=hours)).isoformat(),
            "priority": "normal", "category": "fyi", "needs_reply": False, "summary": "", "_who": f"Person {i}", **kw}


class Timing(unittest.TestCase):
    def test_due_after_their_briefing_time_in_their_zone(self):
        jhb = ZoneInfo("Africa/Johannesburg")
        self.assertEqual(due_today(NOW, jhb, "07:00:00"), date(2026, 10, 23))
        self.assertIsNone(due_today(NOW, jhb, "09:00:00"))
        self.assertIsNone(due_today(NOW, ZoneInfo("America/New_York"), "07:00:00"))  # 02:30 there

    def test_unknown_zone_falls_back(self):
        self.assertEqual(zone_of("Not/AZone").key, "Africa/Johannesburg")
        self.assertEqual(zone_of(None).key, "Africa/Johannesburg")


class Sections(unittest.TestCase):
    def test_like_the_summary_page(self):
        threads = [
            thread(1, 5, needs_reply=True, priority="important"),
            thread(2, 2, needs_reply=True, priority="urgent"),
            thread(3, 30, priority="urgent", category="work"),
            thread(4, 3, category="fyi", summary="Rates went up"),
            thread(5, 3, category="newsletter", priority="important"),
            thread(6, 400, needs_reply=True),  # waiting too long: left to Conversations
            thread(7, 1, needs_reply=True, junk=True),
        ]
        got = sections(threads, NOW)
        self.assertEqual([t["id"] for t in got["reply"]], ["2", "1"])
        self.assertEqual([t["id"] for t in got["priority"]], ["3"])
        self.assertEqual([t["id"] for t in got["updates"]], ["4"])

    def test_prompt_has_events_in_local_time_and_who_is_waiting(self):
        jhb = ZoneInfo("Africa/Johannesburg")
        events = [{"title": "Viewing", "starts_at": "2026-10-23T13:00:00+00:00", "ends_at": "2026-10-23T14:00:00+00:00", "all_day": False, "location": "12 Oak Street"},
                  {"title": "Heritage Day", "starts_at": "2026-10-23T00:00:00+00:00", "ends_at": None, "all_day": True, "location": None}]
        parts = sections([thread(1, 5, needs_reply=True, channel="whatsapp", summary="Asks if Thursday at 3 works.")], NOW)
        p = build_prompt("Matthew Prowse", date(2026, 10, 23), jhb, events, parts, NOW)
        self.assertIn("Their first name: Matthew", p)
        self.assertIn("- 15:00 to 16:00: Viewing, at 12 Oak Street", p)
        self.assertIn("- all day: Heritage Day", p)
        self.assertIn("- Person 1 (WhatsApp, 5 hours ago, normal): Asks if Thursday at 3 works.", p)
        self.assertIn("Urgent or important:\n(none)", p)


class Audio(unittest.TestCase):
    def test_pcm_is_wrapped_and_timed(self):
        wav = pcm_to_wav(b"\0\0" * 24000 * 3, 24000)
        self.assertTrue(wav.startswith(b"RIFF"))
        self.assertEqual(wav_seconds(wav), 3)


class FakeDb:
    def __init__(self):
        self.briefs = [{"id": "b1", "user_id": "u1", "for_date": "2026-10-23", "status": "pending"}]
        self.updates = []

    def select(self, table, params):
        if table == "briefs" and params.get("status") == "eq.pending":
            return [b for b in self.briefs if b["status"] == "pending"]
        if table == "briefs":
            return [{"user_id": b["user_id"], "for_date": b["for_date"]} for b in self.briefs]
        if table == "profiles":
            return [{"user_id": "u1", "timezone": "Africa/Johannesburg", "briefing_time": "07:00:00"}]
        if table == "threads":
            return [{**thread(1, 5, needs_reply=True, summary="Wants the lease signed."), "is_group": False, "group_name": None,
                     "thread_participants": [{"contacts": {"display_name": "Sam Naidoo"}}]}]
        return []

    def first(self, table, params):
        return {"display_name": "Matthew", "timezone": "Africa/Johannesburg"}

    def update(self, table, filters, patch, minimal=False):
        self.updates.append((filters, patch))
        if filters.get("status") == "eq.pending":
            for b in self.briefs:
                if b["status"] == "pending":
                    b["status"] = patch["status"]
                    return [b]
            return []
        return []

    def delete(self, table, filters):
        pass

    def insert_new(self, table, row, on_conflict):
        raise AssertionError("today's brief already exists")


class FakeGemini:
    def __init__(self):
        self.prompts = []

    def json(self, model, system, prompt, schema, usage, **kw):
        self.prompts.append(prompt)
        return {"script": "Good morning Matthew. Sam Naidoo wants the lease signed."}

    def speak(self, model, text, voice, usage):
        return pcm_to_wav(b"\0\0" * 24000 * 2, 24000)


class Writing(unittest.TestCase):
    def test_pending_brief_is_written_and_sealed(self):
        db, gemini = FakeDb(), FakeGemini()
        self.assertEqual(Brief(db, gemini, "m", "tts", "Kore").run_once(), 1)
        self.assertIn("Sam Naidoo", gemini.prompts[0])
        ready = [p for _, p in db.updates if p.get("status") == "ready"][0]
        self.assertEqual(ready["seconds"], 2)
        self.assertEqual(ready["script"], "Good morning Matthew. Sam Naidoo wants the lease signed.")  # no vault key: plaintext passes
        self.assertTrue(base64.b64decode(ready["audio"]).startswith(b"RIFF"))


class ChoiceSignals(unittest.TestCase):
    def test_choices_and_what_was_sent_reach_the_learner(self):
        p = signals_prompt([], [], [], [("other_time", "I can do Friday at 9.", "Hi Sam, Friday at 9 at the office works."), ("decline", "I can't make it.", "")])
        self.assertIn("--- Picked: other time: I can do Friday at 9.\nThey sent: Hi Sam, Friday at 9 at the office works.", p)
        self.assertIn("They sent: (nothing yet)", p)
        self.assertIn("Choices they picked, newest first:\n(none)", signals_prompt([], [], []))


if __name__ == "__main__":
    unittest.main()
