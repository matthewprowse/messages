"""Tests for ai.brief: when a brief is due in the user's zone, which conversations make the sections, the prompt, writing
and sealing the brief, lazy speech, audio file storage and cleanup, and splitting the script into spoken parts.
Also defines FakeDb and FakeGemini, reused by test_brief_tasks."""

import base64
import io
import unittest
import wave
from datetime import date, datetime, timedelta, timezone
from unittest import mock
from zoneinfo import ZoneInfo

from ai.brief import AUDIO_BUCKET, FIRST_PART_WORDS, KEEP_LEAD_MS, KEEP_TAIL_MS, PART_WORDS, PART_WORDS_BY_SEQ, Brief, audio_path, build_prompt, due_today, sections, split_parts, trim_silence, wav_seconds, zone_of
from ai.gemini import pcm_to_wav
from ai.signals import build_prompt as signals_prompt

NOW = datetime(2026, 10, 23, 6, 30, tzinfo=timezone.utc)  # 08:30 in Johannesburg


def wav_frames(wav: bytes) -> int:
    with wave.open(io.BytesIO(wav), "rb") as w:
        return w.getnframes()


class FixedNow(datetime):
    """datetime with now() held at NOW, for code that asks the clock."""

    @classmethod
    def now(cls, tz=None):
        return NOW if tz is None else NOW.astimezone(tz)


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

    def test_answered_conversations_are_left_out(self):
        threads = [
            thread(1, 2, priority="urgent", last_from_me=True),
            thread(2, 2, category="work", summary="Signed and sent.", last_from_me=True),
            thread(3, 2, needs_reply=True, last_from_me=True),
        ]
        got = sections(threads, NOW)
        self.assertEqual(got, {"reply": [], "priority": [], "updates": []})

    def test_prompt_has_events_in_local_time_and_who_is_waiting(self):
        jhb = ZoneInfo("Africa/Johannesburg")
        events = [{"title": "Viewing", "starts_at": "2026-10-23T13:00:00+00:00", "ends_at": "2026-10-23T14:00:00+00:00", "all_day": False, "location": "12 Oak Street"},
                  {"title": "Heritage Day", "starts_at": "2026-10-23T00:00:00+00:00", "ends_at": None, "all_day": True, "location": None}]
        parts = sections([thread(1, 5, needs_reply=True, channel="whatsapp", summary="Asks if Thursday at 3 works.")], NOW)
        p = build_prompt("Matthew Prowse", date(2026, 10, 23), jhb, events, parts, NOW)
        self.assertIn("Their first name: Matthew", p)
        self.assertIn("- 15:00 to 16:00: Viewing, at 12 Oak Street", p)
        self.assertIn("- all day: Heritage Day", p)
        self.assertIn("- Person 1 (WhatsApp, 5 hours ago): Asks if Thursday at 3 works.", p)
        self.assertIn("Urgent or important:\n(none)", p)

    def test_conversations_without_a_summary_are_not_offered(self):
        jhb = ZoneInfo("Africa/Johannesburg")
        parts = sections([thread(1, 5, needs_reply=True, summary=""), thread(2, 4, needs_reply=True, summary="Wants the invoice paid.")], NOW)
        p = build_prompt("Matthew", date(2026, 10, 23), jhb, [], parts, NOW)
        self.assertNotIn("Person 1", p)
        self.assertIn("- Person 2 (email, 4 hours ago): Wants the invoice paid.", p)


class Audio(unittest.TestCase):
    def test_pcm_is_wrapped_and_timed(self):
        wav = pcm_to_wav(b"\0\0" * 24000 * 3, 24000)
        self.assertTrue(wav.startswith(b"RIFF"))
        self.assertEqual(wav_seconds(wav), 3)


class FakeDb:
    def __init__(self, status="pending", script=None):
        """One brief for today in the given status, or none at all when status is None."""
        today = datetime.now(ZoneInfo("Africa/Johannesburg")).date().isoformat()  # run_once checks the real clock
        self.today = today
        self.briefs = [{"id": "b1", "user_id": "u1", "for_date": today, "status": status, "script": script}] if status else []
        self.updates = []
        self.parts = []
        self.files = {}  # path -> bytes, the brief-audio bucket
        self.deleted = []  # (table, filters)
        self.old = []  # briefs old enough to be pruned: {"id", "user_id"}
        self.accounts = [{"id": "a1"}]  # connected accounts of the user
        self.news = [{"id": "m1"}]  # messages since their last brief

    def upload(self, bucket, path, data, content_type="application/octet-stream"):
        assert bucket == AUDIO_BUCKET
        self.files[path] = data

    def list_files(self, bucket, prefix):
        return [p[len(prefix) + 1:] for p in self.files if p.startswith(prefix + "/") and "/" not in p[len(prefix) + 1:]]

    def remove_files(self, bucket, paths):
        for p in paths:
            self.files.pop(p, None)

    def insert(self, table, row):
        self.parts.append(row)
        return [row]

    def select(self, table, params):
        if table == "briefs" and str(params.get("status", "")).startswith("eq."):
            return [b for b in self.briefs if b["status"] == params["status"][3:]]
        if table == "briefs" and str(params.get("for_date", "")).startswith("lt."):
            old, self.old = self.old, []  # a second look finds none: the batch was deleted
            return old
        if table == "briefs":
            return [{"user_id": b["user_id"], "for_date": b["for_date"]} for b in self.briefs]
        if table == "accounts":
            return self.accounts
        if table == "messages":
            return self.news
        if table == "profiles":
            return [{"user_id": "u1", "timezone": "Africa/Johannesburg", "briefing_time": "07:00:00"}]
        if table == "threads":
            return [{**thread(1, 5, needs_reply=True, summary="Wants the lease signed."), "is_group": False, "group_name": None,
                     "thread_participants": [{"contacts": {"display_name": "Sam Naidoo"}}]}]
        return []

    def first(self, table, params):
        if table == "briefs" and params.get("select") == "created_at":
            return None
        if table == "briefs":
            return {"script": self.briefs[0]["script"]}
        return {"display_name": "Matthew", "timezone": "Africa/Johannesburg", "brief_voice": "Sulafat"}

    def update(self, table, filters, patch, minimal=False):
        self.updates.append((filters, patch))
        wanted = str(filters.get("status", ""))
        if "id" in filters and wanted in ("eq.pending", "eq.speak_pending"):  # a claim; the sweep has no id
            for b in self.briefs:
                if b["status"] == wanted[3:]:
                    b["status"] = patch["status"]
                    return [b]
            return []
        return []

    def delete(self, table, filters):
        self.deleted.append((table, filters))

    def insert_new(self, table, row, on_conflict):
        if self.briefs:
            raise AssertionError("today's brief already exists")
        self.briefs.append({"id": "b1", "user_id": row["user_id"], "for_date": row["for_date"], "status": row["status"], "script": None})
        return [self.briefs[0]]


class FakeGemini:
    blocked = False

    def billing_blocked(self):
        return self.blocked

    def __init__(self):
        self.prompts = []

    def json(self, model, system, prompt, schema, usage, **kw):
        self.prompts.append(prompt)
        return {"script": "Good morning Matthew. Sam Naidoo wants the lease signed by Friday, and the buyers asked to see the garden again. " + "Nothing else is waiting on you today, so it should be a quiet one. " * 4}

    def speak(self, model, text, voice, usage):
        self.spoken = getattr(self, "spoken", 0) + 1
        self.voices = getattr(self, "voices", []) + [voice]
        return pcm_to_wav(b"\0\0" * 24000 * 2, 24000)


class Writing(unittest.TestCase):
    def test_pending_brief_is_written_and_sealed(self):
        db, gemini = FakeDb(), FakeGemini()
        self.assertEqual(Brief(db, gemini, "m", "tts", "Kore").run_once(), 1)
        self.assertIn("Sam Naidoo", gemini.prompts[0])
        speaking = [p for _, p in db.updates if p.get("status") == "speaking"][0]
        ready = [p for _, p in db.updates if p.get("status") == "ready"][0]
        self.assertTrue(speaking["script"].startswith("Good morning Matthew."))  # no vault key: plaintext passes
        self.assertEqual((speaking["voice"], speaking["parts"]), ("Sulafat", len(db.parts)))
        self.assertGreater(len(db.parts), 1)
        self.assertEqual(sorted(p["seq"] for p in db.parts), list(range(len(db.parts))))
        self.assertEqual(ready["seconds"], 2 * len(db.parts))
        self.assertTrue(all("audio" not in p for p in db.parts))
        self.assertEqual([p["audio_path"] for p in db.parts], [audio_path("u1", "b1", i) for i in range(len(db.parts))])
        self.assertEqual(set(db.files), {p["audio_path"] for p in db.parts})
        self.assertTrue(base64.b64decode(db.files[db.parts[0]["audio_path"]]).startswith(b"RIFF"))  # no vault key: unsealed base64
        self.assertEqual(set(gemini.voices), {"Sulafat"})


class Lazy(unittest.TestCase):
    """Speech is nearly all of what a brief costs, so it is made only for someone who listens."""

    def test_the_morning_brief_is_a_script_without_speech(self):
        db, gemini = FakeDb(status=None), FakeGemini()
        # Past the 07:00 briefing time in Johannesburg, whatever the clock says when the tests run.
        with mock.patch("ai.brief.datetime", FixedNow):
            self.assertEqual(Brief(db, gemini, "m", "tts", "Kore").run_once(), 1)
        written = [p for _, p in db.updates if p.get("status") == "written" and "script" in p]
        self.assertEqual(len(written), 1)
        self.assertTrue(written[0]["script"].startswith("Good morning Matthew."))
        self.assertEqual((written[0]["parts"], written[0]["voice"]), (None, None))
        self.assertEqual(db.parts, [])
        self.assertEqual(getattr(gemini, "spoken", 0), 0)

    def test_a_brief_asked_to_be_spoken_is_spoken_in_the_voice_chosen_now(self):
        script = "Good morning Matthew. " + "Nothing else is waiting on you today, so it should be a quiet one. " * 4
        db, gemini = FakeDb(status="speak_pending", script=script), FakeGemini()
        self.assertEqual(Brief(db, gemini, "m", "tts", "Kore").run_once(), 1)
        self.assertEqual(gemini.prompts, [])  # the script is not written again
        speaking = [p for _, p in db.updates if p.get("status") == "speaking"][0]
        ready = [p for _, p in db.updates if p.get("status") == "ready"][0]
        self.assertEqual((speaking["voice"], speaking["parts"]), ("Sulafat", len(db.parts)))
        self.assertGreater(len(db.parts), 1)
        self.assertEqual(ready["seconds"], 2 * len(db.parts))
        self.assertEqual(set(gemini.voices), {"Sulafat"})

    def test_a_request_nobody_took_goes_back_to_written(self):
        db = FakeDb(status="written", script="Good morning.")
        Brief(db, FakeGemini(), "m", "tts", "Kore")._sweep(datetime.now(timezone.utc))
        back = [(f, p) for f, p in db.updates if p.get("status") == "written"]
        self.assertEqual(back[0][0]["status"], "eq.speak_pending")


class Gating(unittest.TestCase):
    def test_a_daily_brief_is_not_made_for_someone_with_no_connected_account_or_no_news(self):
        for kw in ({"accounts": []}, {"news": []}):
            db, gemini = FakeDb(status=None), FakeGemini()
            for k, v in kw.items():
                setattr(db, k, v)
            b = Brief(db, gemini, "m", "tts", "Kore")
            self.assertEqual(b.run_once(), 0)
            self.assertEqual((gemini.prompts, db.briefs), ([], []))
            b.run_once()  # and not looked up again at once
            self.assertTrue(b._quiet)

    def test_a_quiet_user_is_checked_again_after_a_while(self):
        from ai import brief as brief_module

        db, gemini = FakeDb(status=None), FakeGemini()
        db.news = []
        b = Brief(db, gemini, "m", "tts", "Kore")
        with mock.patch.object(brief_module.time, "monotonic", return_value=1000.0):
            b.run_once()
        db.news = [{"id": "m1"}]
        with mock.patch.object(brief_module.time, "monotonic", return_value=1000.0 + brief_module.QUIET_RECHECK_S + 1):
            self.assertEqual(b.run_once(), 1)

    def test_nothing_is_claimed_or_requeued_while_billing_is_paused(self):
        db, gemini = FakeDb(status="pending"), FakeGemini()
        gemini.blocked = True
        self.assertEqual(Brief(db, gemini, "m", "tts", "Kore").run_once(), 0)
        self.assertEqual(db.briefs[0]["status"], "pending")
        self.assertEqual(db.deleted, [])


class Sweeping(unittest.TestCase):
    def test_the_sweep_runs_every_few_minutes_not_on_every_look(self):
        from ai import brief as brief_module

        db = FakeDb(status="written", script="Good morning.")
        b = Brief(db, FakeGemini(), "m", "tts", "Kore")
        with mock.patch.object(brief_module.time, "monotonic", return_value=1000.0):
            b.run_once()
            first = len(db.updates)
            b.run_once()
            self.assertEqual(len(db.updates), first)  # no sweep the second time
        with mock.patch.object(brief_module.time, "monotonic", return_value=1000.0 + brief_module.SWEEP_EVERY_S + 1):
            b.run_once()
            self.assertGreater(len(db.updates), first)

    def test_audio_is_kept_two_days(self):
        from ai.brief import KEEP_DAYS

        self.assertEqual(KEEP_DAYS, 2)


class Storage(unittest.TestCase):
    def test_path_is_user_brief_and_sequence(self):
        self.assertEqual(audio_path("u1", "b1", 3), "u1/b1/3.wav")
        # brief_parts_audio_check: under the user and brief, at most 200 characters.
        uid = "123e4567-e89b-12d3-a456-426614174000"
        self.assertLessEqual(len(audio_path(uid, uid, 99)), 200)
        self.assertTrue(audio_path(uid, uid, 0).startswith(f"{uid}/{uid}/"))

    def test_sealed_files_are_stored_not_the_plain_audio(self):
        class Sealing:
            def seal(self, user_id, field, value):
                return "enc:" + value[::-1]

            def open(self, user_id, field, value):
                return value[4:][::-1] if str(value).startswith("enc:") else value

        db = FakeDb(status="speak_pending", script="Good morning Matthew. " + "Nothing else is waiting on you today, so it should be a quiet one. " * 4)
        Brief(db, FakeGemini(), "m", "tts", "Kore", Sealing()).run_once()
        stored = db.files[db.parts[0]["audio_path"]]
        self.assertTrue(stored.startswith(b"enc:"))

    def test_speaking_again_replaces_the_old_files(self):
        db = FakeDb(status="speak_pending", script="Good morning Matthew. " + "Nothing else is waiting on you today, so it should be a quiet one. " * 4)
        db.files["u1/b1/7.wav"] = b"old"  # a part the new speech will not have
        db.files["u1/b2/0.wav"] = b"another brief"
        Brief(db, FakeGemini(), "m", "tts", "Kore").run_once()
        self.assertNotIn("u1/b1/7.wav", db.files)
        self.assertIn("u1/b2/0.wav", db.files)
        self.assertEqual(len([p for p in db.files if p.startswith("u1/b1/")]), len(db.parts))
        self.assertIn(("brief_parts", {"brief_id": "eq.b1"}), db.deleted)

    def test_old_briefs_lose_their_files_before_their_rows(self):
        db = FakeDb(status="ready")
        db.old = [{"id": "old1", "user_id": "u1"}, {"id": "old2", "user_id": "u1"}]
        db.files.update({"u1/old1/0.wav": b"a", "u1/old1/1.wav": b"b", "u1/old2/0.wav": b"c", "u1/b1/0.wav": b"today"})
        Brief(db, FakeGemini(), "m", "tts", "Kore")._sweep(datetime.now(timezone.utc))
        self.assertEqual(set(db.files), {"u1/b1/0.wav"})
        self.assertIn(("briefs", {"id": 'in.("old1","old2")'}), db.deleted)

    def test_a_brief_whose_files_would_not_go_keeps_its_row(self):
        class Failing(FakeDb):
            def remove_files(self, bucket, paths):
                if any("/old1/" in p for p in paths):
                    raise RuntimeError("storage down")
                super().remove_files(bucket, paths)

        db = Failing(status="ready")
        db.old = [{"id": "old1", "user_id": "u1"}, {"id": "old2", "user_id": "u1"}]
        db.files.update({"u1/old1/0.wav": b"a", "u1/old2/0.wav": b"c"})
        Brief(db, FakeGemini(), "m", "tts", "Kore")._sweep(datetime.now(timezone.utc))
        self.assertIn("u1/old1/0.wav", db.files)
        self.assertEqual([f for t, f in db.deleted if t == "briefs"], [{"id": 'in.("old2")'}])

    def test_a_part_that_cannot_be_recorded_does_not_leave_its_file(self):
        class NoInsert(FakeDb):
            def insert(self, table, row):
                raise RuntimeError("insert failed")

        db = NoInsert(status="pending")
        Brief(db, FakeGemini(), "m", "tts", "Kore").run_once()
        self.assertEqual(db.files, {})


class Parts(unittest.TestCase):
    def test_short_first_part_then_longer_ones_at_sentence_ends(self):
        script = "Good morning. " + " ".join(f"Sentence number {i} has exactly seven words." for i in range(60))
        parts = split_parts(script)
        self.assertLessEqual(len(parts[0].split()), FIRST_PART_WORDS)
        for seq, part in enumerate(parts):
            self.assertLessEqual(len(part.split()), PART_WORDS_BY_SEQ[min(seq, len(PART_WORDS_BY_SEQ) - 1)])
        self.assertTrue(all(len(p.split()) <= PART_WORDS for p in parts))
        self.assertTrue(all(p.endswith(".") for p in parts))
        self.assertEqual(" ".join(parts), script)
        # Parts grow, so a long brief has few places where one part hands over to the next.
        self.assertLess(len(parts[1].split()), len(parts[2].split()))
        self.assertLessEqual(len(parts), 5)

    def test_silence_at_a_parts_ends_is_cut_short(self):
        rate = 24000
        quiet, loud = b"\0\0" * rate, (3000).to_bytes(2, "little", signed=True) * rate
        trimmed = trim_silence(pcm_to_wav(quiet + loud + quiet, rate))
        # One second of speech, plus what is kept at each end.
        self.assertAlmostEqual(wav_frames(trimmed) / rate, 1 + (KEEP_LEAD_MS + KEEP_TAIL_MS) / 1000, places=2)
        silent = pcm_to_wav(quiet, rate)
        self.assertEqual(trim_silence(silent), silent)

    def test_one_long_sentence_is_one_part(self):
        long = " ".join(["word"] * 60) + "."
        self.assertEqual(split_parts(long), [long])


class ChoiceSignals(unittest.TestCase):
    def test_choices_and_what_was_sent_reach_the_learner(self):
        p = signals_prompt([], [], [], [("other_time", "I can do Friday at 9.", "Hi Sam, Friday at 9 at the office works."), ("decline", "I can't make it.", "")])
        self.assertIn("--- Picked: other time: I can do Friday at 9.\nThey sent: Hi Sam, Friday at 9 at the office works.", p)
        self.assertIn("They sent: (nothing yet)", p)
        self.assertIn("Choices they picked, newest first:\n(none)", signals_prompt([], [], []))


if __name__ == "__main__":
    unittest.main()
