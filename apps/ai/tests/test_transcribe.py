"""Tests for ai.transcribe: audio type normalisation, the query for saved voice notes without a transcript, the recent
window, that a paused budget never fails the note, and that outside senders cannot spend the allowance: a stranger's
note is deferred unless the user asked for it, a conversation's notes are capped per day (asked for or not), and the cost
goes to its own voice_notes feature."""

import unittest
from datetime import datetime, timedelta, timezone

from ai.transcribe import audio_type, pending_query, recent


class Transcribe(unittest.TestCase):
    def test_audio_type_drops_codec_parameters(self):
        self.assertEqual(audio_type("audio/ogg; codecs=opus"), "audio/ogg")
        self.assertEqual(audio_type(None), "audio/ogg")
        self.assertEqual(audio_type("audio/mpeg"), "audio/mpeg")

    def test_pending_query_finds_saved_voice_notes_without_a_transcript(self):
        q = pending_query([])
        self.assertEqual(q["kind"], "eq.audio")  # the name is sealed: voice notes are told apart after it is opened
        self.assertEqual(q["storage_path"], "not.is.null")
        self.assertEqual(q["messages.or"], "(transcript_status.is.null,transcript_status.eq.requested)")  # new, or asked for in the app
        self.assertNotIn("messages.id", q)
        self.assertEqual(pending_query(["a", "b"])["messages.id"], "not.in.(a,b)")

    def test_recent_is_the_triage_window(self):
        now = datetime.now(timezone.utc)
        self.assertTrue(recent((now - timedelta(days=2)).isoformat()))
        self.assertFalse(recent((now - timedelta(days=45)).isoformat()))
        self.assertFalse(recent("not a date"))


class BudgetErrors(unittest.TestCase):
    def test_a_paused_budget_is_not_a_try_and_never_fails_the_note(self):
        from unittest import mock

        from ai.gemini import GeminiError
        from ai.transcribe import MAX_TRIES, Transcribe as Worker

        db = mock.Mock()
        worker = Worker(db, mock.Mock(), "m", mock.Mock())
        m = {"id": "m1"}
        for _ in range(MAX_TRIES + 2):
            worker._failed(m, GeminiError(None, "budget_paused"))
        worker._failed(m, GeminiError(None, "budget_unknown"))
        db.update.assert_not_called()  # never marked failed
        self.assertEqual(worker._tries["m1"][0], 0)
        self.assertEqual(worker.waiting(), ["m1"])  # waits RETRY_S before the next look
        worker._failed(m, GeminiError(500, "boom"))
        self.assertEqual(worker._tries["m1"][0], 1)  # a real failure still counts


class AnyFailure(unittest.TestCase):
    def test_an_unexpected_error_is_a_try_and_the_next_note_still_runs(self):
        from unittest import mock

        from ai.transcribe import Transcribe as Worker

        def row(n):
            return {"id": f"a{n}", "filename": "Voice Note.ogg", "messages": {"id": f"m{n}", "user_id": "u", "thread_id": "t1"}}

        db = mock.Mock()
        db.select.return_value = [row(1), row(2)]
        db.count.return_value = 0
        worker = Worker(db, mock.Mock(), "m", mock.Mock())
        worker.is_voice_note = lambda user_id, filename: True
        worker._one = mock.Mock(side_effect=[KeyError("no key"), 1])
        self.assertEqual(worker.run_once(), 1)
        self.assertEqual(worker._tries["m1"][0], 1)
        self.assertEqual(worker.waiting(), ["m1"])  # left out of the next query, so it cannot sit at the head

    def test_paused_billing_downloads_nothing(self):
        from unittest import mock

        from ai.gemini import GeminiError
        from ai.transcribe import Transcribe as Worker

        db, gemini = mock.Mock(), mock.Mock()
        gemini.billing_blocked.return_value = True
        worker = Worker(db, gemini, "m", mock.Mock())
        with self.assertRaises(GeminiError):
            worker._one({"id": "a1", "storage_path": "p"}, {"id": "m1", "user_id": "u"})
        db.download.assert_not_called()


class OutsideSenders(unittest.TestCase):
    def worker(self, written_in=True, done_today=0, status=None):
        from unittest import mock

        from ai.transcribe import Transcribe as Worker

        db = mock.Mock()
        db.first.return_value = {"id": "out1"} if written_in else None
        db.count.return_value = done_today
        db.select.return_value = [{"id": "a1", "filename": "Voice Note.ogg", "messages": {"id": "m1", "user_id": "u", "thread_id": "t1", "transcript_status": status}}]
        worker = Worker(db, mock.Mock(), "m", mock.Mock())
        worker.is_voice_note = lambda user_id, filename: True
        worker._one = mock.Mock(return_value=1)
        return worker, db

    def test_a_note_from_someone_the_user_never_wrote_to_is_deferred_not_transcribed(self):
        worker, db = self.worker(written_in=False)
        self.assertEqual(worker.run_once(), 0)
        worker._one.assert_not_called()
        db.update.assert_called_once_with("messages", {"id": "eq.m1"}, {"transcript": None, "transcript_status": "deferred"}, minimal=True)

    def test_a_note_the_user_asked_for_is_transcribed_though_they_never_wrote_there(self):
        worker, db = self.worker(written_in=False, status="requested")
        self.assertEqual(worker.run_once(), 1)
        worker._one.assert_called_once()
        db.update.assert_not_called()  # not deferred again; _one stores done, silent or failed

    def test_a_note_the_user_asked_for_still_waits_on_the_daily_cap(self):
        from ai.transcribe import PER_SENDER_DAY

        worker, db = self.worker(written_in=False, done_today=PER_SENDER_DAY, status="requested")
        self.assertEqual(worker.run_once(), 0)
        worker._one.assert_not_called()
        db.update.assert_not_called()
        self.assertIn("m1", worker.waiting())

    def test_a_note_from_a_conversation_the_user_writes_in_is_transcribed(self):
        worker, db = self.worker()
        self.assertEqual(worker.run_once(), 1)
        self.assertEqual(db.first.call_args[0][1]["direction"], "eq.outbound")

    def test_a_conversation_over_its_daily_cap_waits_for_the_next_day_without_a_try(self):
        from ai.transcribe import PER_SENDER_DAY

        worker, db = self.worker(done_today=PER_SENDER_DAY)
        self.assertEqual(worker.run_once(), 0)
        worker._one.assert_not_called()
        db.update.assert_not_called()
        self.assertIn("m1", worker.waiting(), "left out of the next query until the cap lifts")
        self.assertNotIn("m1", worker._tries)

    def test_deferred_notes_go_back_in_the_queue_once_the_user_writes_there(self):
        import time

        from ai.transcribe import REVISIT_S

        worker, db = self.worker()
        db.select.return_value = [{"id": "m7", "thread_id": "t1"}]
        worker._revisited = time.monotonic() - REVISIT_S - 1
        worker._revisit()
        db.update.assert_called_once_with("messages", {"id": "in.(m7)", "transcript_status": "eq.deferred"}, {"transcript_status": None}, minimal=True)

    def test_voice_notes_are_billed_to_their_own_feature_not_the_meetings_one(self):
        from unittest import mock

        from ai.transcribe import FEATURE, Transcribe as Worker

        self.assertEqual(FEATURE, "voice_notes")
        db, gemini, vault = mock.Mock(), mock.Mock(), mock.Mock()
        gemini.billing_blocked.return_value = False
        gemini.json.return_value = {"speech": False, "transcript": "", "language": "English"}
        vault.open_bytes.return_value = b"OggS"
        Worker(db, gemini, "m", vault)._one({"id": "a1", "storage_path": "p", "size_bytes": 10}, {"id": "m1", "user_id": "u", "thread_id": "t1"})
        self.assertEqual(gemini.json.call_args[0][4].feature, "voice_notes")
