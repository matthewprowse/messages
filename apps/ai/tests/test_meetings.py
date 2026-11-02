"""Tests for ai.meetings: planning queries and windows, turning transcript turns into segments, transcribing short
(inline) and long (uploaded, hour by hour) recordings, budget holds, the minutes cap, retries and giving up, and
summary and action items sealing. Uses its own fakes for the vault, database and Gemini."""

import json
from contextlib import contextmanager
import unittest
from unittest import mock

from ai.fields import MEETING_ACTIONS, SUMMARY, TRANSCRIPT
from ai.gemini import Gemini, GeminiError
from ai.http import Response
from ai.meetings import (
    INLINE_BYTES,
    MAX_TRIES,
    NO_RECORDING,
    NO_SPEECH,
    NOT_SUMMARISED,
    TOO_LONG,
    SINGLE_S,
    SUMMARY_CHARS,
    WINDOW_S,
    Meetings,
    clock,
    read_segments,
    recording_length,
    recording_query,
    start_of,
    summary_query,
    tidy,
    transcribe_prompt,
    transcript_text,
    turns_in,
    windows,
)
from ai.supabase import SupabaseError

USER = "u1"
MEETING = "m1"
PATH = f"{USER}/meetings/{MEETING}/abc"


class FakeVault:
    """Seals by tagging with the field, so tests can see what was sealed under which name."""

    def seal(self, user_id, field, value):
        return None if value is None else f"sealed:{field}:{value}"

    def open(self, user_id, field, value):
        prefix = f"sealed:{field}:"
        return value[len(prefix):] if isinstance(value, str) and value.startswith(prefix) else value


class FakeDb:
    def __init__(self, meetings=None, participants=None, audio=b"x" * 100, missing=False):
        self.meetings = meetings or []
        self.participants = participants or [{"name": "Sarah Lee"}, {"name": "Me Myself"}]
        self.audio = audio
        self.missing = missing
        self.updates = []
        self.queries = []

    def select(self, table, params):
        self.queries.append((table, params))
        if table == "meetings":
            status = params["status"].split(".", 1)[1]
            skip = params.get("id", "not.in.()")[len("not.in.("):-1].split(",")
            return [m for m in self.meetings if m["status"] == status and m["id"] not in skip]
        if table == "meeting_participants":
            return self.participants
        return []

    def update(self, table, filters, patch, minimal=False):
        self.updates.append((table, filters, patch))
        mid = filters["id"].split(".", 1)[1]
        status = filters["status"].split(".", 1)[1]
        for m in self.meetings:
            if m["id"] == mid and m["status"] == status:
                m.update(patch)
        return []

    def download(self, bucket, path, timeout=60):
        if self.missing:
            raise SupabaseError(404, None)
        return self.audio


class FakeHold:
    def __init__(self, amount):
        self.amount = amount
        self.topped = []

    def top_up(self, more):
        self.topped.append(more)
        self.amount += more


class FakeGemini:
    def __init__(self, answers=None, fail=0, cache=True, refuse=False):
        self.answers = list(answers or [])
        self.calls = []
        self.uploads = []
        self.deleted = []
        self.fail = fail
        self.cache = cache
        self.refuse = refuse
        self.holds = []
        self.caches = []
        self.caches_deleted = []

    blocked = False

    def billing_blocked(self):
        return self.blocked

    @contextmanager
    def hold(self, usage, estimate, strict=True):
        if self.refuse:
            raise GeminiError(None, "budget_paused")
        held = FakeHold(estimate)
        self.holds.append((usage, estimate, held))
        yield held

    def cache_file(self, model, system, file, usage, ttl_s=1500):
        if not self.cache:
            return None
        self.caches.append((model, file))
        return "cachedContents/c1"

    def delete_cache(self, name):
        self.caches_deleted.append(name)

    def json(self, model, system, prompt, schema, usage, **kw):
        self.calls.append({"prompt": prompt, "usage": usage, **kw})
        if self.fail:
            self.fail -= 1
            raise GeminiError(503, "UNAVAILABLE")
        return self.answers.pop(0)

    def upload_file(self, data, mime):
        self.uploads.append((len(data), mime))
        return "files/f1", "https://generativelanguage.googleapis.com/v1beta/files/f1"

    def delete_file(self, name):
        self.deleted.append(name)


def waiting(**kw):
    meta = {"recording": {"storage_path": PATH, "mime_type": "audio/mp4; codecs=mp4a"}}
    return {
        "id": MEETING,
        "user_id": USER,
        "account_id": "a1",
        "platform": "zoom",
        "status": "waiting",
        "started_at": "2026-10-27T08:00:00+00:00",
        "ended_at": "2026-10-27T08:40:00+00:00",
        "provider_meta": meta,
        **kw,
    }


def turns(*items, speech=True, ends=False):
    return {"speech": speech, "ends": ends, "turns": [{"speaker": s, "start_s": t, "text": x} for s, t, x in items]}


class Planning(unittest.TestCase):
    def test_queries_pick_up_each_step(self):
        q = recording_query([])
        self.assertEqual(q["status"], "eq.waiting")
        self.assertEqual(q["transcript_source"], "eq.recording")
        self.assertEqual(q["provider_meta->recording->>storage_path"], "not.is.null")
        self.assertNotIn("id", q)
        self.assertEqual(recording_query(["a", "b"])["id"], "not.in.(a,b)")
        self.assertEqual(summary_query([])["status"], "eq.transcribed")
        self.assertIn("transcript", summary_query([])["select"])

    def test_recording_length_prefers_what_the_platform_says(self):
        self.assertEqual(recording_length(waiting()), 2400)
        self.assertEqual(recording_length(waiting(provider_meta={"recording": {"duration_s": 90}})), 90)
        self.assertIsNone(recording_length(waiting(ended_at=None)))
        self.assertIsNone(recording_length(waiting(provider_meta={"recording": {"duration_s": True}}, ended_at=None)))

    def test_short_recordings_are_one_call_and_long_ones_an_hour_at_a_time(self):
        self.assertEqual(windows(40 * 60), [(0, None)])
        self.assertEqual(windows(SINGLE_S), [(0, None)])
        self.assertEqual(windows(2.5 * 3600), [(0, WINDOW_S), (WINDOW_S, 2 * WINDOW_S), (2 * WINDOW_S, 3 * WINDOW_S)])
        self.assertEqual(len(windows(None)), 6)  # unknown: up to the cap, stopping at the end
        self.assertEqual(len(windows(20 * 3600)), 6)

    def test_clock_and_start_times(self):
        self.assertEqual(clock(65), "01:05")
        self.assertEqual(clock(3725), "1:02:05")
        self.assertEqual(start_of(12.5), 12.5)
        self.assertEqual(start_of("01:05"), 65)
        self.assertEqual(start_of("1:02:05"), 3725)
        self.assertIsNone(start_of("soon"))
        self.assertIsNone(start_of(-1))
        self.assertIsNone(start_of(True))

    def test_prompt_names_people_and_the_part_wanted(self):
        p = transcribe_prompt(["Sarah Lee"], (3600, 7200), ["Sarah Lee", "Speaker 2"])
        self.assertIn("People in the meeting: Sarah Lee.", p)
        self.assertIn("Speaker 2", p)
        self.assertIn("from 1:00:00 to 2:00:00", p)
        self.assertIn("whole recording", transcribe_prompt([], (0, None), []))


class Segments(unittest.TestCase):
    def test_turns_become_segments_within_their_window(self):
        items = [
            {"speaker": " Sarah  Lee ", "start_s": 3590, "text": "Before  the window"},
            {"speaker": "Sarah Lee", "start_s": 3598, "text": "Just before, kept"},
            {"speaker": "", "start_s": "1:00:10", "text": "Hello"},
            {"speaker": "Tom", "start_s": None, "text": "No time given"},
            {"speaker": "Tom", "start_s": 7200, "text": "Next window"},
            {"speaker": "Tom", "start_s": 3700, "text": "   "},
            "junk",
        ]
        got = turns_in(items, (3600, 7200))
        self.assertEqual(
            got,
            [
                {"speaker": "Sarah Lee", "start_ms": 3598000, "text": "Just before, kept"},
                {"speaker": "Speaker", "start_ms": 3610000, "text": "Hello"},
                {"speaker": "Tom", "start_ms": 3610000, "text": "No time given"},
            ],
        )
        self.assertEqual(turns_in(None, (0, None)), [])

    def test_stored_transcripts_read_back(self):
        stored = json.dumps([{"speaker": "Sarah", "start_ms": 1500, "text": "Hi"}, {"speaker": "Tom", "text": ""}, "x"])
        self.assertEqual(read_segments(stored), [{"speaker": "Sarah", "start_ms": 1500, "text": "Hi"}])
        self.assertEqual(read_segments("plain words"), [{"speaker": "", "start_ms": 0, "text": "plain words"}])
        self.assertEqual(read_segments(None), [])

    def test_transcript_text_cuts_the_middle_of_a_long_one(self):
        segs = [{"speaker": "Sarah", "start_ms": 65000, "text": "Hello there"}]
        self.assertEqual(transcript_text(segs), "[01:05] Sarah: Hello there")
        many = [{"speaker": "S", "start_ms": i * 1000, "text": f"line {i} " + "x" * 50} for i in range(10000)]
        text = transcript_text(many)
        self.assertLessEqual(len(text), SUMMARY_CHARS + 100)
        self.assertIn("line 0 ", text)
        self.assertIn("line 9999 ", text)
        self.assertIn("middle of the meeting is left out", text)

    def test_tidy_drops_dashes(self):
        self.assertEqual(tidy("Agreed — send it\n tomorrow", 100), "Agreed, send it tomorrow")
        self.assertEqual(tidy("10–12 May", 100), "10-12 May")
        self.assertEqual(tidy(None, 10), "")


class Transcribing(unittest.TestCase):
    def test_a_short_recording_is_sent_inline_and_sealed_as_json(self):
        db = FakeDb([waiting()])
        gemini = FakeGemini([turns(("Sarah Lee", 3, "Morning all."), ("Speaker 2", 1, "Hi Sarah."))])
        self.assertEqual(Meetings(db, gemini, "model", FakeVault()).transcribe_once(), 1)
        call = gemini.calls[0]
        self.assertEqual(call["audio"], (b"x" * 100, "audio/mp4"))
        self.assertNotIn("file", call)
        self.assertEqual(call["usage"].feature, "transcribe")
        self.assertIn("Sarah Lee, Me Myself", call["prompt"])
        _, filters, patch = db.updates[-1]
        self.assertEqual(filters, {"id": f"eq.{MEETING}", "status": "eq.waiting"})
        self.assertEqual(patch["status"], "transcribed")
        self.assertIsNone(patch["error"])
        prefix = f"sealed:{TRANSCRIPT}:"
        self.assertTrue(patch["transcript"].startswith(prefix))
        # Sorted by time, in the migration's format.
        self.assertEqual(
            json.loads(patch["transcript"][len(prefix):]),
            [{"speaker": "Speaker 2", "start_ms": 1000, "text": "Hi Sarah."}, {"speaker": "Sarah Lee", "start_ms": 3000, "text": "Morning all."}],
        )

    def test_a_long_recording_is_uploaded_and_done_an_hour_at_a_time(self):
        meeting = waiting(ended_at="2026-10-27T10:30:00+00:00")  # two and a half hours
        db = FakeDb([meeting], audio=b"y" * (INLINE_BYTES + 1))
        gemini = FakeGemini([
            turns(("Sarah Lee", 10, "First hour."), ("Tom", 3650, "Heard twice, kept in the second.")),
            turns(("Tom", 3650, "Heard twice, kept in the second."), ("Sarah Lee", 7000, "Second hour.")),
            turns(("Sarah Lee", 7300, "Last bit."), ends=True),
        ])
        Meetings(db, gemini, "model", FakeVault()).transcribe_once()
        self.assertEqual(gemini.uploads, [(INLINE_BYTES + 1, "audio/mp4")])
        self.assertEqual(gemini.deleted, ["files/f1"])
        self.assertEqual(len(gemini.calls), 3)
        self.assertTrue(all(c["file"][0].endswith("files/f1") and "audio" not in c for c in gemini.calls))
        self.assertIn("from 1:00:00 to 2:00:00", gemini.calls[1]["prompt"])
        self.assertIn("Speakers labelled so far, to keep using for the same voices: Sarah Lee.", gemini.calls[1]["prompt"])
        stored = json.loads(meeting["transcript"].split(":", 2)[2])
        self.assertEqual([s["text"] for s in stored], ["First hour.", "Heard twice, kept in the second.", "Second hour.", "Last bit."])

    def test_each_recording_is_sent_once_and_the_windows_share_one_cache(self):
        db = FakeDb([waiting(ended_at="2026-10-27T10:30:00+00:00")], audio=b"y" * 100)
        gemini = FakeGemini([turns(("A", 10, "one")), turns(("A", 3700, "two")), turns(("A", 7300, "three"), ends=True)])
        Meetings(db, gemini, "model", FakeVault()).transcribe_once()
        self.assertEqual(len(gemini.uploads), 1)  # the file goes up once
        self.assertEqual(len(gemini.caches), 1)  # and is cached once, for all three windows
        self.assertEqual({c["cached"] for c in gemini.calls}, {"cachedContents/c1"})
        self.assertEqual(len(gemini.calls), 3)
        self.assertEqual(gemini.caches_deleted, ["cachedContents/c1"])
        self.assertEqual(gemini.deleted, ["files/f1"])

    def test_a_recording_that_cannot_be_cached_falls_back_and_asks_for_the_difference(self):
        db = FakeDb([waiting(ended_at="2026-10-27T10:30:00+00:00")])
        gemini = FakeGemini([turns(("A", 10, "one")), turns(("A", 3700, "two")), turns(("A", 7300, "three"), ends=True)], cache=False)
        Meetings(db, gemini, "gemini-3.8-flash", FakeVault()).transcribe_once()
        self.assertEqual(len(gemini.calls), 3)
        self.assertTrue(all(c.get("cached") is None for c in gemini.calls))
        self.assertEqual(len(gemini.holds[0][2].topped), 1)
        self.assertGreater(gemini.holds[0][2].topped[0], 0)

    def test_the_whole_cost_is_held_once_before_the_first_call_and_passed_to_every_call(self):
        db = FakeDb([waiting(ended_at="2026-10-27T10:30:00+00:00")])
        gemini = FakeGemini([turns(("A", 10, "one")), turns(("A", 3700, "two")), turns(("A", 7300, "three"), ends=True)])
        Meetings(db, gemini, "gemini-3.8-flash", FakeVault()).transcribe_once()
        self.assertEqual(len(gemini.holds), 1)
        usage, estimate, held = gemini.holds[0]
        self.assertEqual(usage.feature, "transcribe")
        self.assertGreater(estimate, 0)
        self.assertTrue(all(c["hold"] is held for c in gemini.calls))

    def test_a_meeting_the_share_cannot_cover_waits_without_a_try_or_any_upload(self):
        db = FakeDb([waiting()])
        gemini = FakeGemini(refuse=True)
        job = Meetings(db, gemini, "model", FakeVault())
        job.transcribe_once()
        self.assertEqual(db.meetings[0]["status"], "waiting")
        self.assertEqual(gemini.calls, [])
        self.assertEqual(gemini.uploads, [])
        self.assertEqual(job._tries[MEETING][0], 0)  # not counted against the meeting
        self.assertEqual(job.waiting(), [MEETING])

    def test_a_recording_over_the_minutes_cap_is_refused_before_download_or_hold(self):
        db = FakeDb([waiting(ended_at="2026-10-27T13:00:01+00:00")])  # five hours
        gemini = FakeGemini()
        Meetings(db, gemini, "model", FakeVault()).transcribe_once()
        self.assertEqual((db.meetings[0]["status"], db.meetings[0]["error"]), ("failed", TOO_LONG))
        self.assertEqual(gemini.holds, [])
        self.assertEqual(gemini.calls, [])

    def test_the_cap_comes_from_the_environment(self):
        import os

        os.environ["MEETING_MAX_MINUTES"] = "30"
        try:
            db = FakeDb([waiting()])  # 40 minutes
            Meetings(db, FakeGemini(), "model", FakeVault()).transcribe_once()
            self.assertEqual(db.meetings[0]["error"], TOO_LONG)
        finally:
            del os.environ["MEETING_MAX_MINUTES"]

    def test_windows_never_run_past_the_cap(self):
        from ai.meetings import windows

        self.assertEqual(len(windows(None, 2 * 3600)), 2)
        self.assertEqual(len(windows(None)), 6)

    def test_recordings_use_the_transcribe_model(self):
        calls = []
        gemini = FakeGemini([turns(("A", 1, "x"))])
        original = gemini.json
        gemini.json = lambda model, *a, **k: (calls.append(model), original(model, *a, **k))[1]
        Meetings(FakeDb([waiting()]), gemini, "full", FakeVault(), transcribe_model="cheap").transcribe_once()
        self.assertEqual(calls, ["cheap"])

    def test_an_unknown_length_stops_where_the_recording_ends(self):
        db = FakeDb([waiting(ended_at=None)])
        gemini = FakeGemini([turns(("Sarah", 5, "Hello.")), turns(ends=True)])
        Meetings(db, gemini, "model", FakeVault()).transcribe_once()
        self.assertEqual(len(gemini.calls), 2)
        self.assertEqual(db.meetings[0]["status"], "transcribed")

    def test_silence_fails_with_a_reason(self):
        db = FakeDb([waiting()])
        Meetings(db, FakeGemini([turns(speech=False)]), "model", FakeVault()).transcribe_once()
        self.assertEqual(db.meetings[0]["status"], "failed")
        self.assertEqual(db.meetings[0]["error"], NO_SPEECH)

    def test_a_recording_outside_its_meeting_folder_or_gone_is_not_found(self):
        db = FakeDb([waiting(provider_meta={"recording": {"storage_path": "other/meetings/m1/x"}})])
        gemini = FakeGemini()
        Meetings(db, gemini, "model", FakeVault()).transcribe_once()
        self.assertEqual(db.meetings[0]["error"], NO_RECORDING)
        self.assertEqual(gemini.calls, [])
        db = FakeDb([waiting()], missing=True)
        Meetings(db, gemini, "model", FakeVault()).transcribe_once()
        self.assertEqual((db.meetings[0]["status"], db.meetings[0]["error"]), ("failed", NO_RECORDING))

    def test_failures_wait_and_then_give_up(self):
        db = FakeDb([waiting()])
        gemini = FakeGemini(fail=MAX_TRIES)
        job = Meetings(db, gemini, "model", FakeVault())
        job.transcribe_once()
        self.assertEqual(db.meetings[0]["status"], "waiting")
        self.assertEqual(job.waiting(), [MEETING])
        job.transcribe_once()  # still pausing: not tried again yet
        self.assertEqual(len(gemini.calls), 1)
        for _ in range(MAX_TRIES - 1):
            job._tries[MEETING] = (job._tries[MEETING][0], 0.0)  # the pause is over
            job.transcribe_once()
        self.assertEqual(db.meetings[0]["status"], "failed")
        self.assertEqual(job.waiting(), [])


def transcribed(**kw):
    segs = [{"speaker": "Sarah Lee", "start_ms": 0, "text": "Can you send the offer by Friday?"}, {"speaker": "Me Myself", "start_ms": 4000, "text": "Yes, I will."}]
    return {
        "id": MEETING,
        "user_id": USER,
        "account_id": "a1",
        "platform": "teams",
        "title": "sealed:meeting_title:Offer review",
        "status": "transcribed",
        "started_at": "2026-10-27T08:00:00+00:00",
        "ended_at": "2026-10-27T08:30:00+00:00",
        "transcript": f"sealed:{TRANSCRIPT}:" + json.dumps(segs),
        **kw,
    }


class Summarising(unittest.TestCase):
    def test_summary_and_actions_are_sealed(self):
        db = FakeDb([transcribed()])
        gemini = FakeGemini([{"summary": "They reviewed the offer — it goes out Friday.", "action_items": ["Send the signed offer by Friday", " ", 3]}])
        self.assertEqual(Meetings(db, gemini, "model", FakeVault()).summarise_once(), 1)
        call = gemini.calls[0]
        self.assertIn("Meeting on Microsoft Teams", call["prompt"])
        self.assertIn("Title: Offer review", call["prompt"])
        self.assertIn("[00:04] Me Myself: Yes, I will.", call["prompt"])
        self.assertEqual(call["usage"].feature, "transcribe")
        self.assertEqual(call["max_output"], 4096)
        _, filters, patch = db.updates[-1]
        self.assertEqual(filters["status"], "eq.transcribed")
        self.assertEqual(patch["status"], "summarised")
        self.assertEqual(patch["summary"], f"sealed:{SUMMARY}:They reviewed the offer, it goes out Friday.")
        self.assertEqual(patch["action_items"], f"sealed:{MEETING_ACTIONS}:" + json.dumps(["Send the signed offer by Friday"]))

    def test_an_empty_transcript_needs_no_call(self):
        db = FakeDb([transcribed(transcript=None)])
        gemini = FakeGemini()
        Meetings(db, gemini, "model", FakeVault()).summarise_once()
        self.assertEqual(gemini.calls, [])
        self.assertEqual(db.meetings[0]["status"], "summarised")
        self.assertIsNone(db.meetings[0]["summary"])

    def test_a_summary_that_keeps_failing_is_given_up_on(self):
        db = FakeDb([transcribed()])
        job = Meetings(db, FakeGemini(fail=MAX_TRIES), "model", FakeVault())
        for _ in range(MAX_TRIES):
            for mid in list(job._tries):
                job._tries[mid] = (job._tries[mid][0], 0.0)
            job.summarise_once()
        self.assertEqual(db.meetings[0]["status"], "failed")
        self.assertEqual(db.meetings[0]["error"], NOT_SUMMARISED)
        # The transcript stays, so it can still be read.
        self.assertTrue(db.meetings[0]["transcript"])

    def test_run_once_does_both_steps(self):
        db = FakeDb([waiting()])
        gemini = FakeGemini([turns(("Sarah", 1, "Hello.")), {"summary": "A short hello.", "action_items": []}])
        self.assertEqual(Meetings(db, gemini, "model", FakeVault()).run_once(), 2)
        self.assertEqual(db.meetings[0]["status"], "summarised")

    def test_a_recording_that_breaks_with_an_unexpected_error_is_a_try_and_does_not_block_summaries(self):
        db = FakeDb([waiting(), transcribed(id="m2")])

        class Broken(FakeVault):
            def seal(self, user_id, field, value):
                if field == TRANSCRIPT:
                    raise KeyError("no key")
                return super().seal(user_id, field, value)

        job = Meetings(db, FakeGemini([turns(("Sarah", 1, "Hello.")), {"summary": "Short.", "action_items": []}]), "model", Broken())
        self.assertEqual(job.run_once(), 1)  # the summary got through
        self.assertEqual(job._tries[MEETING][0], 1)
        self.assertEqual([m["status"] for m in db.meetings], ["waiting", "summarised"])

    def test_a_failing_step_does_not_stop_the_other_in_run_once(self):
        job = Meetings(FakeDb([transcribed()]), FakeGemini([{"summary": "Short.", "action_items": []}]), "model", FakeVault())
        with mock.patch.object(job, "transcribe_once", side_effect=RuntimeError("boom")):
            self.assertEqual(job.run_once(), 1)

    def test_a_recording_that_cannot_be_opened_is_tried_again_not_failed_at_once(self):
        class NoKey(FakeVault):
            def open_bytes(self, user_id, field, data):
                return None

        db = FakeDb([waiting(provider_meta={"recording": {"storage_path": PATH, "mime_type": "audio/mp4", "sealed": True}})])
        job = Meetings(db, FakeGemini(), "model", NoKey())
        job.transcribe_once()
        self.assertEqual((db.meetings[0]["status"], job._tries[MEETING][0]), ("waiting", 1))

    def test_a_paused_billing_downloads_and_uploads_nothing_and_is_not_a_try(self):
        db = FakeDb([waiting()])
        gemini = FakeGemini()
        gemini.blocked = True
        db.download = mock.Mock(side_effect=AssertionError("downloaded"))
        job = Meetings(db, gemini, "model", FakeVault())
        job.transcribe_once()
        self.assertEqual((gemini.uploads, job._tries[MEETING][0], db.meetings[0]["status"]), ([], 0, "waiting"))
        self.assertEqual(job.waiting(), [MEETING])


class Upload(unittest.TestCase):
    def test_upload_starts_sends_and_waits_until_ready(self):
        replies = [
            Response(200, {"x-goog-upload-url": "https://upload.example/u?id=1"}, b""),
            Response(200, {}, json.dumps({"file": {"name": "files/f1", "uri": "https://g/files/f1", "state": "PROCESSING"}}).encode()),
            Response(200, {}, json.dumps({"name": "files/f1", "state": "ACTIVE"}).encode()),
        ]
        sent = []

        def request(method, url, body=None, headers=None, timeout=30):
            sent.append((method, url, headers or {}, body))
            return replies.pop(0)

        with mock.patch("ai.gemini.POOL.request", side_effect=request), mock.patch("ai.gemini.time.sleep"):
            self.assertEqual(Gemini("key", None).upload_file(b"abc", "audio/mp4"), ("files/f1", "https://g/files/f1"))
        start, upload, poll = sent
        self.assertEqual(start[2]["X-Goog-Upload-Command"], "start")
        self.assertEqual(start[2]["X-Goog-Upload-Header-Content-Length"], "3")
        self.assertEqual(json.loads(start[3]), {"file": {"display_name": "recording"}})
        self.assertEqual((upload[1], upload[2]["X-Goog-Upload-Command"], upload[3]), ("https://upload.example/u?id=1", "upload, finalize", b"abc"))
        self.assertEqual((poll[0], poll[1]), ("GET", "https://generativelanguage.googleapis.com/v1beta/files/f1"))

    def test_a_refused_upload_raises(self):
        with mock.patch("ai.gemini.POOL.request", return_value=Response(403, {}, b'{"error": {"status": "PERMISSION_DENIED"}}')):
            with self.assertRaises(GeminiError):
                Gemini("key", None).upload_file(b"abc", "audio/mp4")


if __name__ == "__main__":
    unittest.main()
