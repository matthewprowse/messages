"""Tests for ai.transcribe: audio type normalisation, the query for saved voice notes without a transcript, the recent
window, and that a paused budget never fails the note."""

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
        self.assertEqual(q["messages.transcript_status"], "is.null")
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
            return {"id": f"a{n}", "filename": "Voice Note.ogg", "messages": {"id": f"m{n}", "user_id": "u"}}

        db = mock.Mock()
        db.select.return_value = [row(1), row(2)]
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
