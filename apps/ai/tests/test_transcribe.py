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
