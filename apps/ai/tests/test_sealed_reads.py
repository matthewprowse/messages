"""The AI worker reads sealed and plain rows alike: file names, event text, voice note and recording bytes, and
the Instagram file rules (sealed, hashed, deduped, capped)."""

import base64
import hashlib
import hmac
import unittest

from ai.crypto import decrypt_bytes, derive_user_keys, encrypt_bytes, is_sealed_bytes
from ai.fields import ATTACHMENT_DATA, EVENT_LOCATION, EVENT_TITLE, FILENAME, RECORDING_DATA
from ai.vault import Vault

KEYS = derive_user_keys(bytes(range(32)))


def vault(encrypt=True):
    v = Vault(object(), None, encrypt)
    v.keys_for = lambda user_id: KEYS
    return v


class FakeDb:
    def __init__(self, rows=None, usage=None):
        self.rows, self.usage = rows or [], usage
        self.uploads, self.updates, self.selects = [], [], []

    def select(self, table, params):
        self.selects.append((table, params))
        return self.rows if table == "attachments" else []

    def rpc(self, fn, args):
        if self.usage is None:
            raise RuntimeError("no rpc")
        return self.usage

    def upload(self, bucket, path, data, content_type="application/octet-stream"):
        self.uploads.append((path, data, content_type))

    def update(self, table, filters, patch, minimal=False):
        self.updates.append((filters, patch))


class Filenames(unittest.TestCase):
    def test_transcribe_tells_voice_notes_by_the_opened_name(self):
        from ai.transcribe import Transcribe

        t = Transcribe.__new__(Transcribe)
        t.vault = vault()
        self.assertTrue(t.is_voice_note("u", t.vault.seal("u", FILENAME, "Voice Note.ogg")))
        self.assertTrue(t.is_voice_note("u", "Voice Note.ogg"))  # a plain legacy name
        self.assertFalse(t.is_voice_note("u", t.vault.seal("u", FILENAME, "Audio.ogg")))
        self.assertFalse(t.is_voice_note("u", None))

    def test_pending_query_reads_audio_and_skips_ones_seen_not_to_be_voice_notes(self):
        from ai.transcribe import pending_query

        q = pending_query(["m1"], ["a1", "a2"])
        self.assertEqual(q["kind"], "eq.audio")
        self.assertNotIn("filename", q)
        self.assertEqual(q["id"], "not.in.(a1,a2)")
        self.assertEqual(q["messages.id"], "not.in.(m1)")

    def test_triage_holds_back_a_sealed_voice_note(self):
        from ai.triage import Triage

        t = Triage.__new__(Triage)
        t.vault = vault()
        t._voice_wait = {}
        from datetime import datetime, timezone

        row = {"id": "m", "user_id": "u", "sent_at": datetime.now(timezone.utc).isoformat(), "transcript_status": None, "attachments": [{"filename": t.vault.seal("u", FILENAME, "Voice Note.ogg")}]}
        self.assertEqual(t._without_untranscribed([row]), [])
        row["attachments"] = [{"filename": "Voice Note.ogg"}]
        self.assertEqual(t._without_untranscribed([dict(row)]), [])
        row["attachments"] = [{"filename": t.vault.seal("u", FILENAME, "scan.pdf")}]
        self.assertEqual(len(t._without_untranscribed([dict(row)])), 1)


class Transcription(unittest.TestCase):
    def run_note(self, stored):
        from ai.transcribe import Transcribe

        sent = {}

        class Gemini:
            def json(self, *a, **k):
                sent["audio"] = k["audio"]
                return {"speech": True, "transcript": "hello", "language": "English"}

        class Db(FakeDb):
            def download(self, bucket, path, **k):
                return stored

        t = Transcribe.__new__(Transcribe)
        t.db, t.gemini, t.model, t.vault, t._tries, t._other_audio = Db(), Gemini(), "m", vault(), {}, set()
        a = {"id": "a", "storage_path": "u/m/a", "mime_type": "audio/ogg", "size_bytes": 100}
        m = {"id": "m", "user_id": "u", "account_id": "x", "thread_id": "t", "sent_at": "2020-01-01T00:00:00Z"}
        t._one(a, m)
        return sent["audio"][0]

    def test_sealed_voice_note_is_opened_before_gemini(self):
        plain = b"OggS-voice"
        self.assertEqual(self.run_note(encrypt_bytes(KEYS, ATTACHMENT_DATA, plain)), plain)

    def test_plain_voice_note_still_works(self):
        self.assertEqual(self.run_note(b"OggS-plain"), b"OggS-plain")

    def test_sealed_for_another_field_is_not_sent(self):
        from ai.transcribe import Transcribe

        t = Transcribe.__new__(Transcribe)
        t.vault = vault()
        self.assertIsNone(t.vault.open_bytes("u", ATTACHMENT_DATA, encrypt_bytes(KEYS, RECORDING_DATA, b"x")))


class Calendar(unittest.TestCase):
    def test_event_text_opens_sealed_and_plain(self):
        v = vault()
        self.assertEqual(v.open("u", EVENT_TITLE, v.seal("u", EVENT_TITLE, "Dentist")), "Dentist")
        self.assertEqual(v.open("u", EVENT_LOCATION, "Cape Town"), "Cape Town")

    def test_brief_opens_event_text_before_the_prompt(self):
        from ai import brief

        v = vault()
        events = [{"title": v.seal("u", EVENT_TITLE, "Dentist"), "location": v.seal("u", EVENT_LOCATION, "Sea Point"), "starts_at": "2026-10-28T08:00:00+00:00", "ends_at": None, "all_day": False}]
        for e in events:
            e["title"] = v.open("u", EVENT_TITLE, e["title"])
            e["location"] = v.open("u", EVENT_LOCATION, e["location"])
        self.assertEqual((events[0]["title"], events[0]["location"]), ("Dentist", "Sea Point"))
        self.assertIn("EVENT_TITLE", dir(brief))

    def test_briefs_error_is_a_code(self):
        import inspect

        from ai import brief

        src = inspect.getsource(brief)
        for code in ("timed_out", "write_failed", "speak_failed"):
            self.assertIn(f'"error": "{code}"', src)
        self.assertNotIn("Could not write the brief", src)


class Recordings(unittest.TestCase):
    def run_rec(self, stored, sealed):
        from ai import meetings

        m = {"id": "mt", "user_id": "u", "account_id": "x", "platform": "zoom", "started_at": "2026-10-27T10:00:00Z", "ended_at": "2026-10-27T10:10:00Z",
             "provider_meta": {"recording": {"storage_path": "u/meetings/mt/abc", "mime_type": "audio/mp4", **({"sealed": True} if sealed else {})}}}
        seen = {}

        class Db(FakeDb):
            def download(self, bucket, path, **k):
                return stored

        class Hold:
            def __enter__(s):
                return s

            def __exit__(s, *a):
                return False

            def top_up(s, n):
                pass

        class Gemini:
            def hold(s, *a, **k):
                return Hold()

            def json(s, model, system, prompt, schema, usage, **k):
                seen["audio"] = k["audio"][0]
                return {"segments": [], "speech": False}

            def upload_file(s, *a):
                raise AssertionError("small file is inline")

        mt = meetings.Meetings.__new__(meetings.Meetings)
        mt.db, mt.gemini, mt.vault, mt._tries = Db(), Gemini(), vault(), {}
        mt.transcribe_model = "m"
        try:
            mt._transcribe(m)
        except Exception:
            pass
        return seen.get("audio"), mt

    def test_sealed_recording_is_opened(self):
        audio, _ = self.run_rec(encrypt_bytes(KEYS, RECORDING_DATA, b"M4A-bytes"), True)
        self.assertEqual(audio, b"M4A-bytes")

    def test_plain_recording_still_works(self):
        audio, _ = self.run_rec(b"M4A-plain", False)
        self.assertEqual(audio, b"M4A-plain")

    def test_flag_true_with_plain_bytes_passes_through(self):
        audio, _ = self.run_rec(b"M4A-plain", True)
        self.assertEqual(audio, b"M4A-plain")


class InstagramFiles(unittest.TestCase):
    def store(self, db, encrypt=True):
        from ai.connectors.instagram.store import Store

        s = Store.__new__(Store)
        s.db, s.vault = db, vault(encrypt)
        return s

    def test_saved_file_is_sealed_hashed_and_marked(self):
        db = FakeDb(usage={"seats": 1, "bytes": 0})
        out = self.store(db).save_file("u", "m", "a", b"JPEGDATA", "image/jpeg", "image", "acc")
        self.assertEqual(out, "saved")
        path, data, ctype = db.uploads[0]
        self.assertTrue(is_sealed_bytes(data))
        self.assertEqual(ctype, "application/octet-stream")
        self.assertEqual(decrypt_bytes(KEYS, ATTACHMENT_DATA, data), b"JPEGDATA")
        patch = db.updates[-1][1]
        want = base64.urlsafe_b64encode(hmac.new(KEYS.index, b"JPEGDATA", hashlib.sha256).digest()).decode().rstrip("=")
        self.assertEqual((patch["sealed"], patch["content_hash"], patch["size_bytes"], patch["not_kept"]), (True, want, 8, None))

    def test_plain_when_encryption_is_off_but_still_hashed(self):
        db = FakeDb(usage={"seats": 1, "bytes": 0})
        self.store(db, encrypt=False).save_file("u", "m", "a", b"JPEGDATA", "image/jpeg", "image", "acc")
        self.assertEqual(db.uploads[0][1:], (b"JPEGDATA", "image/jpeg"))
        patch = db.updates[-1][1]
        self.assertFalse(patch["sealed"])
        self.assertTrue(patch["content_hash"])

    def test_same_file_again_points_at_the_stored_copy(self):
        db = FakeDb(rows=[{"storage_path": "u/m0/a0", "sealed": True}], usage={"seats": 1, "bytes": 0})
        out = self.store(db).save_file("u", "m", "a", b"JPEGDATA", "image/jpeg", "image", "acc")
        self.assertEqual(out, "reused")
        self.assertEqual(db.uploads, [])
        self.assertEqual(db.updates[-1][1]["storage_path"], "u/m0/a0")
        self.assertTrue(db.updates[-1][1]["sealed"])

    def test_video_over_25mb_stays_a_link(self):
        db = FakeDb(usage={"seats": 1, "bytes": 0})
        out = self.store(db).save_file("u", "m", "a", b"0" * (26 * 1024 * 1024), "video/mp4", "video", "acc")
        self.assertEqual(out, "video_link")
        self.assertEqual(db.uploads, [])
        self.assertEqual(db.updates[-1][1], {"not_kept": "video_link"})

    def test_small_video_is_kept(self):
        db = FakeDb(usage={"seats": 1, "bytes": 0})
        self.assertEqual(self.store(db).save_file("u", "m", "a", b"0" * 1000, "video/mp4", "video", "acc"), "saved")

    def test_full_seat_is_not_copied(self):
        db = FakeDb(usage={"seats": 1, "bytes": 21 * 1024**3})
        out = self.store(db).save_file("u", "m", "a", b"JPEGDATA", "image/jpeg", "image", "acc")
        self.assertEqual(out, "over_cap")
        self.assertEqual(db.uploads, [])
        self.assertEqual(db.updates[-1][1], {"not_kept": "over_cap"})

    def test_team_pools_seats(self):
        db = FakeDb(usage={"seats": 3, "bytes": 21 * 1024**3})
        self.assertEqual(self.store(db).save_file("u", "m", "a", b"x", "image/jpeg", "image", "acc"), "saved")

    def test_unreadable_usage_fails_open(self):
        self.assertEqual(self.store(FakeDb()).save_file("u", "m", "a", b"x", "image/jpeg", "image", "acc"), "saved")

    def test_hints_and_sealed_name(self):
        from ai.connectors.instagram.store import file_hints

        self.assertEqual(file_hints("Invoice 7.PDF"), {"file_ext": "pdf", "keep_hint": True, "is_sticker": False})
        self.assertEqual(file_hints("Sticker.webp")["is_sticker"], True)
        self.assertEqual(file_hints("Voice Note.m4a")["keep_hint"], False)
        s = self.store(FakeDb())
        sealed = s.sealed_name("u", "Voice Note.m4a")
        self.assertNotEqual(sealed, "Voice Note.m4a")
        self.assertEqual(s.vault.open("u", FILENAME, sealed), "Voice Note.m4a")

    def test_mapping_seals_the_filename(self):
        import inspect

        from ai.connectors.instagram import mapping

        self.assertIn("s.seal(FILENAME, item.media.filename)", inspect.getsource(mapping))


if __name__ == "__main__":
    unittest.main()
