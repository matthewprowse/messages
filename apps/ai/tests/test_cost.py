"""Cost and safety levers: startup guard, audio pricing, context caching, the batch client, idle back-off, caps."""

import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

from ai import config
from ai.chasers import _changed
from ai.gemini import Gemini, GeminiError, Usage, UsageContext, estimate_cost, modality_tokens, read_usage
from ai.logos import Logos
from ai.poll import Backoff
from ai.pricing import cost_usd
from ai.transcribe import Transcribe, note_seconds, ogg_seconds


class Env:
    """Sets environment variables for a test and puts them back."""

    def __init__(self, **values):
        self.values = values

    def __enter__(self):
        self.saved = {k: os.environ.get(k) for k in self.values}
        for k, v in self.values.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def __exit__(self, *exc):
        for k, v in self.saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


class StartupGuard(unittest.TestCase):
    def test_encryption_flags_default_on(self):
        with Env(ENCRYPT_CONTENT=None, ENCRYPT_ADDRESSES=""):
            self.assertTrue(config.flag_on("ENCRYPT_CONTENT"))
            self.assertTrue(config.flag_on("ENCRYPT_ADDRESSES"))

    def test_only_false_turns_them_off(self):
        for off in ("false", "FALSE", "off", "0"):
            with Env(ENCRYPT_CONTENT=off):
                self.assertFalse(config.flag_on("ENCRYPT_CONTENT"))
        with Env(ENCRYPT_CONTENT="true"):
            self.assertTrue(config.flag_on("ENCRYPT_CONTENT"))

    def test_production_refuses_to_start_with_either_off(self):
        with self.assertRaises(SystemExit):
            config.check_encryption(False, True, prod=True)
        with self.assertRaises(SystemExit):
            config.check_encryption(True, False, prod=True)
        config.check_encryption(True, True, prod=True)

    def test_outside_production_off_is_allowed(self):
        config.check_encryption(False, False, prod=False)

    def test_production_is_read_from_the_environment(self):
        with Env(APP_ENV="production", ENVIRONMENT=None, NODE_ENV=None, PYTHON_ENV=None):
            self.assertTrue(config.production())
            with self.assertRaises(SystemExit):
                config.check_encryption(False, True)
        with Env(APP_ENV=None, ENVIRONMENT=None, NODE_ENV="development", PYTHON_ENV=None):
            self.assertFalse(config.production())

    def test_cheaper_models_default_to_the_fast_model_and_transcripts_to_the_full_one(self):
        env = {"SUPABASE_URL": "u", "SUPABASE_SERVICE_ROLE_KEY": "k", "GEMINI_API_KEY": "g", "GEMINI_MODEL": "big", "GEMINI_FAST_MODEL": "small"}
        blank = dict.fromkeys(["LEARN_MODEL", "BRIEF_MODEL", "PREDRAFT_MODEL", "GEMINI_TRANSCRIBE_MODEL", "ENCRYPT_CONTENT", "ENCRYPT_ADDRESSES", "APP_ENV", "NODE_ENV", "ENVIRONMENT", "PYTHON_ENV"])
        with mock.patch.object(config, "_load_env_file"), Env(**{**blank, **env}):
            cfg = config.load()
            self.assertEqual((cfg.learn_model, cfg.brief_model, cfg.predraft_model, cfg.transcribe_model), ("small", "small", "small", "big"))
            self.assertTrue(cfg.encrypt_content and cfg.encrypt_addresses)
        with mock.patch.object(config, "_load_env_file"), Env(**{**blank, **env, "LEARN_MODEL": "mid", "GEMINI_TRANSCRIBE_MODEL": "t"}):
            cfg = config.load()
            self.assertEqual((cfg.learn_model, cfg.transcribe_model), ("mid", "t"))


class AudioPricing(unittest.TestCase):
    day = datetime(2026, 10, 27, tzinfo=timezone.utc).date()

    def test_audio_input_costs_more_than_the_same_tokens_as_text(self):
        with Env(AUDIO_INPUT_USD_PER_M=None):
            text = cost_usd("gemini-3.8-flash", self.day, 1_000_000, 0, 0)
            audio = cost_usd("gemini-3.8-flash", self.day, 1_000_000, 0, 0, 1_000_000)
        self.assertAlmostEqual(text, 0.75)
        self.assertAlmostEqual(audio, 3.00)

    def test_the_audio_rate_can_be_set(self):
        with Env(AUDIO_INPUT_USD_PER_M="1.5"):
            self.assertAlmostEqual(cost_usd("gemini-3.8-flash", self.day, 1_000_000, 0, 0, 1_000_000), 1.5)
        with Env(AUDIO_INPUT_USD_PER_M="nonsense"):
            self.assertAlmostEqual(cost_usd("gemini-3.8-flash", self.day, 1_000_000, 0, 0, 1_000_000), 3.0)

    def test_the_modality_breakdown_is_read_from_usage(self):
        meta = {
            "promptTokenCount": 1000,
            "candidatesTokenCount": 0,
            "promptTokensDetails": [{"modality": "TEXT", "tokenCount": 100}, {"modality": "AUDIO", "tokenCount": 900}],
        }
        self.assertEqual(modality_tokens(meta["promptTokensDetails"], "AUDIO"), 900)
        with Env(AUDIO_INPUT_USD_PER_M=None):
            used = read_usage("gemini-3.8-flash", meta, datetime(2026, 10, 27, tzinfo=timezone.utc))
        self.assertAlmostEqual(used.cost_usd, (100 * 0.75 + 900 * 3.0) / 1e6, places=6)

    def test_cached_audio_is_cheaper_than_fresh_audio(self):
        with Env(AUDIO_INPUT_USD_PER_M=None):
            fresh = cost_usd("gemini-3.8-flash", self.day, 100_000, 0, 0, 100_000)
            cached = cost_usd("gemini-3.8-flash", self.day, 100_000, 100_000, 0, 100_000, 100_000)
        self.assertLess(cached, fresh / 5)

    def test_a_reservation_counts_audio_and_the_whole_output_allowance(self):
        body = {"contents": [{"parts": [{"text": "x" * 300}, {"inlineData": {"mimeType": "audio/ogg", "data": "A" * 4000}}]}]}
        small = estimate_cost("gemini-3.8-flash", body, 100)
        large = estimate_cost("gemini-3.8-flash", body, 50_000)
        self.assertGreater(large, small)
        self.assertEqual(estimate_cost("unknown-model", body, 100), 0.0)


class Stub(Gemini):
    """Gemini with the network replaced: _call records each request body."""

    def __init__(self, db, answers=None):
        super().__init__("key", db)
        self.sent = []
        self.answers = list(answers or [])

    def _call(self, model, body, endpoint="", *, attempts=4, timeout=90, stats=None):
        self.sent.append((endpoint, body))
        if stats is not None:
            stats["attempts"] = 1
        return self.answers.pop(0)


class Db:
    def __init__(self):
        self.rows = []

    def rpc(self, function, args):
        return {"features": {}}

    def insert(self, table, row):
        self.rows.append(row)
        return []


def ok(text='{"ok": true}', usage=None):
    return {"candidates": [{"content": {"parts": [{"text": text}]}}], "usageMetadata": usage or {"promptTokenCount": 10}}


class ContextCaching(unittest.TestCase):
    def test_a_cached_call_sends_neither_the_system_text_nor_the_file(self):
        g = Stub(Db(), [ok()])
        g.json("gemini-3.8-flash", "SYSTEM", "part 2", {}, UsageContext("u", "transcribe"), file=("files/f", "audio/mp4"), cached="cachedContents/c1")
        _, body = g.sent[0]
        self.assertEqual(body["cachedContent"], "cachedContents/c1")
        self.assertNotIn("systemInstruction", body)
        self.assertEqual(body["contents"][0]["parts"], [{"text": "part 2"}])

    def test_an_uncached_call_sends_both(self):
        g = Stub(Db(), [ok()])
        g.json("gemini-3.8-flash", "SYSTEM", "p", {}, UsageContext("u", "transcribe"), file=("files/f", "audio/mp4"))
        _, body = g.sent[0]
        self.assertIn("systemInstruction", body)
        self.assertNotIn("cachedContent", body)
        self.assertEqual(body["contents"][0]["parts"][1]["fileData"]["fileUri"], "files/f")

    def test_cache_file_stores_the_system_text_and_file_once_and_records_the_tokens(self):
        db = Db()
        g = Stub(db, [{"name": "cachedContents/c1", "usageMetadata": {"totalTokenCount": 100_000}}])
        name = g.cache_file("gemini-3.8-flash", "SYSTEM", ("files/f", "audio/mp4"), UsageContext("u", "transcribe"), ttl_s=900)
        self.assertEqual(name, "cachedContents/c1")
        endpoint, body = g.sent[0]
        self.assertTrue(endpoint.endswith("/cachedContents"))
        self.assertEqual(body["model"], "models/gemini-3.8-flash")
        self.assertEqual(body["ttl"], "900s")
        self.assertEqual(body["systemInstruction"]["parts"][0]["text"], "SYSTEM")
        g.close()
        self.assertEqual(db.rows[0]["input_tokens"], 100_000)
        self.assertGreater(db.rows[0]["cost_usd"], 0.2)  # audio rate, not text

    def test_a_cache_that_cannot_be_made_is_none(self):
        class Fails(Stub):
            def _call(self, *a, **k):
                raise GeminiError(400, "INVALID_ARGUMENT")

        self.assertIsNone(Fails(Db()).cache_file("m", "s", ("f", "audio/mp4"), UsageContext("u", "transcribe")))


class BatchClient(unittest.TestCase):
    def test_a_batch_is_submitted_with_a_key_per_request(self):
        g = Stub(Db(), [{"name": "batches/b1"}])
        job = g.batch_submit("gemini-3.5-flash-lite", [("a", {"contents": []}), ("b", {"contents": []})], name="triage")
        self.assertEqual(job, "batches/b1")
        endpoint, body = g.sent[0]
        self.assertIn(":batchGenerateContent", endpoint)
        requests = body["batch"]["input_config"]["requests"]["requests"]
        self.assertEqual([r["metadata"]["key"] for r in requests], ["a", "b"])

    def test_poll_reads_answers_by_key(self):
        class Res:
            status = 200
            body = (
                b'{"done": true, "metadata": {"state": "BATCH_STATE_SUCCEEDED"}, "response": {"inlinedResponses": {"inlinedResponses": '
                b'[{"metadata": {"key": "a"}, "response": {"candidates": []}}]}}}'
            )

        g = Gemini("key", Db())
        with mock.patch("ai.gemini.POOL.request", return_value=Res()):
            state, answers = g.batch_poll("batches/b1")
        self.assertEqual(state, "done")
        self.assertEqual(list(answers), ["a"])

    def test_poll_reports_running_and_failed(self):
        class Res:
            status = 200

            def __init__(self, state, done):
                self.body = ('{"done": %s, "metadata": {"state": "%s"}}' % (done, state)).encode()

        g = Gemini("key", Db())
        with mock.patch("ai.gemini.POOL.request", return_value=Res("BATCH_STATE_RUNNING", "false")):
            self.assertEqual(g.batch_poll("batches/b1"), ("running", {}))
        with mock.patch("ai.gemini.POOL.request", return_value=Res("BATCH_STATE_FAILED", "true")):
            self.assertEqual(g.batch_poll("batches/b1"), ("failed", {}))

    def test_batch_answers_are_recorded_at_half_price(self):
        db = Db()
        g = Gemini("key", db)
        answer = {"usageMetadata": {"promptTokenCount": 1_000_000, "candidatesTokenCount": 0}}
        used = g.batch_settle("gemini-3.8-flash", UsageContext("u", "triage"), answer)
        g.close()
        self.assertAlmostEqual(used.cost_usd, 0.375)
        self.assertAlmostEqual(db.rows[0]["cost_usd"], 0.375)


class IdleBackoff(unittest.TestCase):
    def test_waits_grow_to_the_ceiling_and_snap_back_on_work(self):
        b = Backoff(5, 15)
        self.assertEqual([b.next(False) for _ in range(4)], [5, 10, 15, 15])
        self.assertEqual(b.next(True), 5)
        self.assertEqual(b.next(False), 5)
        self.assertEqual(b.next(False), 10)

    def test_a_ceiling_below_the_base_is_the_base(self):
        b = Backoff(30, 10)
        self.assertEqual([b.next(False) for _ in range(3)], [30, 30, 30])

    def test_the_draft_loop_backs_off_and_returns_to_active(self):
        from ai.drafts import POLL_ACTIVE_S, POLL_IDLE_MAX_S, POLL_IDLE_S, Drafts

        d = Drafts(object(), object(), "m")
        waits = [d.poll_wait() for _ in range(6)]
        self.assertEqual(waits[0], POLL_IDLE_S)
        self.assertEqual(waits[-1], POLL_IDLE_MAX_S)
        d._active_until = 1e12
        self.assertEqual(d.poll_wait(), POLL_ACTIVE_S)
        d._active_until = 0.0
        self.assertEqual(d.poll_wait(), POLL_IDLE_S)


def ogg(seconds):
    """A tiny stand-in for an Ogg Opus file: a last page whose granule position is seconds at 48 kHz."""
    return b"OggS" + b"\x00\x04" + int(seconds * 48000).to_bytes(8, "little") + b"\x00" * 20


class VoiceNoteCap(unittest.TestCase):
    def test_length_is_read_from_the_ogg_header(self):
        self.assertAlmostEqual(ogg_seconds(ogg(42)), 42.0)
        self.assertIsNone(ogg_seconds(b"not ogg"))

    def test_a_known_duration_wins_then_the_header_then_a_size_floor(self):
        self.assertEqual(note_seconds(ogg(10), 99), 99.0)
        self.assertAlmostEqual(note_seconds(ogg(10)), 10.0)
        self.assertAlmostEqual(note_seconds(b"x" * 32_000), 2.0)
        self.assertIsNone(note_seconds(None))

    def job(self, audio):
        class Gem:
            calls = []

            def json(self, *a, **k):
                Gem.calls.append(k)
                return {"speech": True, "transcript": "hi", "language": "English"}

        class D:
            saved = []

            def download(self, bucket, path, timeout=60):
                D.downloaded = True
                return audio

            def update(self, table, filters, patch, minimal=False):
                D.saved.append(patch)
                return []

        D.downloaded = False
        Gem.calls = []
        return Transcribe(D(), Gem(), "m"), D, Gem

    def row(self, **kw):
        return {"id": "a1", "storage_path": "p", "mime_type": "audio/ogg", "size_bytes": 1000, **kw}

    msg = {"id": "m1", "user_id": "u", "account_id": "a", "thread_id": "t", "sent_at": "2020-01-01T00:00:00+00:00"}

    def test_a_note_over_the_limit_is_failed_without_a_model_call(self):
        job, db, gem = self.job(ogg(400))
        job._one(self.row(), self.msg)
        self.assertEqual(db.saved[-1]["transcript_status"], "failed")
        self.assertEqual(gem.calls, [])

    def test_a_stored_duration_is_checked_before_the_download(self):
        job, db, gem = self.job(ogg(10))
        job._one(self.row(duration_s=900), self.msg)
        self.assertFalse(db.downloaded)
        self.assertEqual(db.saved[-1]["transcript_status"], "failed")

    def test_a_short_note_goes_through_with_its_length_for_the_estimate(self):
        job, db, gem = self.job(ogg(30))
        job._one(self.row(), self.msg)
        self.assertEqual(len(gem.calls), 1)
        self.assertAlmostEqual(gem.calls[0]["audio_seconds"], 30.0)
        self.assertIn("max_output", gem.calls[0])

    def test_the_limit_comes_from_the_environment(self):
        with Env(VOICE_NOTE_MAX_SECONDS="20"):
            job, db, gem = self.job(ogg(30))
            job._one(self.row(), self.msg)
            self.assertEqual(gem.calls, [])


class LogoDb:
    def __init__(self, used=0, rows=None):
        self.used = used
        self.rows = rows or []
        self.updates = []
        self.selects = []

    def count(self, table, params):
        return self.used

    def select(self, table, params):
        self.selects.append(params)
        return self.rows

    def update(self, table, filters, patch, minimal=False):
        self.updates.append((filters, patch))
        return []


class LogoLimits(unittest.TestCase):
    def logos(self, db, **env):
        with Env(**env):
            return Logos(db, object(), "m")

    def test_nothing_is_looked_up_past_the_daily_cap(self):
        db = LogoDb(used=200, rows=[{"domain": "a.com", "status": "judging"}])
        self.assertEqual(self.logos(db).run_once(), 0)
        self.assertEqual(db.selects, [])

    def test_a_run_never_takes_more_than_the_cap_leaves(self):
        db = LogoDb(used=198)
        self.logos(db).run_once()
        self.assertEqual(db.selects[0]["limit"], "2")

    def test_the_cap_comes_from_the_environment(self):
        db = LogoDb(used=5)
        self.assertEqual(self.logos(db, LOGO_DAILY_CAP="5").run_once(), 0)

    def test_failed_steps_back_off_then_give_up_for_thirty_days(self):
        db = LogoDb()
        logos = self.logos(db)
        logos._failed({"domain": "a.com", "ai_tries": 0})
        patch = db.updates[-1][1]
        self.assertEqual(patch["ai_tries"], 1)
        self.assertIsNotNone(patch["ai_next_try_at"])
        logos._failed({"domain": "a.com", "ai_tries": 1})
        self.assertEqual(db.updates[-1][1]["ai_tries"], 2)
        logos._failed({"domain": "a.com", "ai_tries": 2})  # the third failure
        patch = db.updates[-1][1]
        self.assertEqual(patch["status"], "done")
        self.assertIsNone(patch["path"])
        until = datetime.fromisoformat(patch["ai_retry_after"])
        self.assertGreater(until - datetime.now(timezone.utc), timedelta(days=29))

    def test_a_paused_budget_is_not_counted_against_the_company(self):
        db = LogoDb()
        self.logos(db)._failed({"domain": "a.com", "ai_tries": 2}, paused=True)
        self.assertNotIn("status", db.updates[-1][1])
        self.assertNotIn("ai_tries", db.updates[-1][1])

    def test_the_maximum_tries_comes_from_the_environment(self):
        db = LogoDb()
        self.logos(db, LOGO_MAX_TRIES="1")._failed({"domain": "a.com", "ai_tries": 0})
        self.assertEqual(db.updates[-1][1]["status"], "done")


class ChangedRows(unittest.TestCase):
    def test_a_thread_is_read_only_when_unchecked_or_changed_since_the_check(self):
        thread = {"last_message_at": "2026-10-20T10:00:00+00:00"}
        self.assertTrue(_changed(thread, None))
        self.assertFalse(_changed(thread, {"checked_at": "2026-10-21T10:00:00+00:00"}))
        self.assertTrue(_changed(thread, {"checked_at": "2026-10-19T10:00:00+00:00"}))

    def test_signals_reads_bodies_only_for_users_whose_drafts_changed(self):
        from ai.signals import Signals

        reads = []

        class SDb:
            def select(self, table, params):
                reads.append(params)
                if params["select"] == "user_id":
                    return [{"user_id": "u1"}, {"user_id": "u1"}]
                return []

        s = Signals(SDb(), object(), "m")
        s._learn = lambda user_id, drafts: 0
        s.run_once()
        self.assertEqual([r["select"] == "user_id" for r in reads], [True, False])
        self.assertEqual(reads[1]["user_id"], "eq.u1")
        self.assertNotIn("updated_at", reads[0])  # the first look is over the whole window
        reads.clear()
        s.run_once()
        self.assertEqual(len(reads), 1)  # nothing changed, and u1 is waiting out its hour: no body read
        self.assertIn("updated_at", reads[0])


class SealedFields(unittest.TestCase):
    """AI-written fields are sealed on write, opened on read, and old plain rows still read."""

    def vault(self, encrypt=True):
        from ai.crypto import derive_user_keys
        from ai.vault import Vault

        keys = derive_user_keys(bytes(range(32)))
        v = Vault(object(), None, encrypt)
        v.keys_for = lambda user_id: keys
        return v, keys

    def test_rules_round_trip_and_plain_rules_still_open(self):
        from ai.fields import STYLE_RULE

        v, _ = self.vault()
        sealed = v.seal("u", STYLE_RULE, "Signs off with Matt")
        self.assertNotEqual(sealed, "Signs off with Matt")
        self.assertEqual(v.open("u", STYLE_RULE, sealed), "Signs off with Matt")
        self.assertEqual(v.open("u", STYLE_RULE, "an old plain rule"), "an old plain rule")

    def test_signals_inserts_sealed_rules_and_matches_against_opened_ones(self):
        from ai.fields import STYLE_RULE
        from ai.signals import Signals

        v, _ = self.vault()
        inserted = []

        class SDb:
            def select(self, table, params):
                return [{"id": "r1", "rule": v.seal("u", STYLE_RULE, "Keeps it short"), "support_count": 1, "enabled": True, "disabled_reason": None}]

            def insert(self, table, rows):
                inserted.append(rows)

            def update(self, *a, **k):
                return []

        class G:
            def json(self, *a, **k):
                return {"rules": [{"rule": "Never uses exclamation marks"}]}

        s = Signals(SDb(), G(), "m", v)
        drafts = [{"id": f"d{i}", "tone": "t", "instruction": f"shorter {i}", "decision": None, "decision_kind": None, "status": "sent", "body": "b", "created_at": "x"} for i in range(5)]
        s._learn("u", drafts)
        sealed = inserted[0][0]["rule"]
        self.assertNotIn("exclamation", sealed)
        self.assertEqual(v.open("u", STYLE_RULE, sealed), "Never uses exclamation marks")

    def test_draft_prompt_parts_open_sealed_contact_fields_rules_and_examples(self):
        from ai.drafts import Drafts
        from ai.fields import CONTACT_RELATIONSHIP, CONTACT_STYLE_NOTE, CONTACT_SUMMARY, STYLE_RULE, WRITING_BODY, WRITING_SITUATION

        v, _ = self.vault()
        d = Drafts(object(), object(), "m", vault=v)
        first = {
            "profile": {"display_name": "Matt"},
            "contact": {
                "id": "c1",
                "display_name": "Sam",
                "relationship": v.seal("u", CONTACT_RELATIONSHIP, "Client"),
                "style_note": v.seal("u", CONTACT_STYLE_NOTE, "Warm, brief"),
                "ai_summary": v.seal("u", CONTACT_SUMMARY, "Runs the fund"),
            },
            "rules": [
                {"rule": v.seal("u", STYLE_RULE, "Global rule"), "scope": "global"},
                {"rule": v.seal("u", STYLE_RULE, "Sam rule"), "scope": "contact", "contact_id": "c1"},
                {"rule": "plain old rule", "scope": "global"},
            ],
            "examples": [{"situation": v.seal("u", WRITING_SITUATION, "Thanks"), "body": v.seal("u", WRITING_BODY, "Cheers, M")}],
            "recent": [],
        }
        parts = d._you("u", first, [])
        self.assertEqual(parts["relationship"], "Client")
        self.assertEqual(parts["style_note"], "Warm, brief")
        self.assertEqual(parts["who_they_are"], "Runs the fund")
        self.assertEqual(parts["rules"], ["Global rule", "plain old rule"])
        self.assertEqual(parts["person_rules"], ["Sam rule"])
        self.assertEqual(parts["examples"], [("Thanks", "Cheers, M")])

    def test_instagram_files_are_sealed_before_upload_in_the_shared_binary_format(self):
        from ai.connectors.instagram.store import Store
        from ai.crypto import decrypt_bytes, is_sealed_bytes
        from ai.fields import ATTACHMENT_DATA

        v, keys = self.vault()
        uploads, updates = [], []

        class SDb:
            def upload(self, bucket, path, data, content_type):
                uploads.append((path, data, content_type))

            def update(self, table, filters, patch, minimal=False):
                updates.append(patch)

        store = Store.__new__(Store)
        store.db, store.vault = SDb(), v
        store.save_file("u", "m", "a", b"JPEGDATA", "image/jpeg")
        path, data, content_type = uploads[0]
        self.assertTrue(is_sealed_bytes(data))
        self.assertEqual(content_type, "application/octet-stream")
        self.assertEqual(decrypt_bytes(keys, ATTACHMENT_DATA, data), b"JPEGDATA")
        self.assertEqual(updates[0]["size_bytes"], 8)  # the real size, not the sealed one

    def test_instagram_files_stay_plain_when_encryption_is_off(self):
        from ai.connectors.instagram.store import Store

        v, _ = self.vault(encrypt=False)
        uploads = []

        class SDb:
            def upload(self, bucket, path, data, content_type):
                uploads.append((data, content_type))

            def update(self, *a, **k):
                pass

        store = Store.__new__(Store)
        store.db, store.vault = SDb(), v
        store.save_file("u", "m", "a", b"JPEGDATA", "image/jpeg")
        self.assertEqual(uploads[0], (b"JPEGDATA", "image/jpeg"))


if __name__ == "__main__":
    unittest.main()
