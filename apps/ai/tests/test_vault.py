"""Tests for ai.vault: key unwrapping and caching, plaintext pass-through, never writing around a key that cannot be
unwrapped, team and rotated keys, and that Triage, Drafts and Learn open what they read and seal what they write."""

import base64
import os
import unittest

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from ai.crypto import derive_team_keys, derive_user_keys, encrypt_bytes, encrypt_field, encrypt_team_field, is_ciphertext
from ai.drafts import Drafts
from ai.fields import BODY, CHOICES, DRAFT, HTML, INSTRUCTION, SUBJECT, SUMMARY, VOICE_INSTRUCTION
from ai.learn import Learn
from ai.triage import Triage
from ai.vault import Vault
from tests.test_ai import FakeTriageDb, FakeTriageGemini

MASTER = os.urandom(32)
MASTER_B64 = base64.b64encode(MASTER).decode()
DATA_KEY = os.urandom(32)
KEYS = derive_user_keys(DATA_KEY)


def wrapped_row(user_id: str, master: bytes = MASTER) -> dict:
    """A user_keys row as the sync worker writes it: local:v1, the user id bound in."""
    iv = os.urandom(12)
    sealed = AESGCM(master).encrypt(iv, DATA_KEY, f"user_keys:{user_id}".encode())
    return {"wrapped_key": base64.b64encode(iv + sealed).decode(), "wrapped_by": "local:v1"}


def enc(field: str, text: str) -> str:
    return encrypt_field(KEYS, field, text)


class KeysDb:
    def __init__(self, rows: dict):
        self.rows = rows
        self.reads: list[str] = []

    def first(self, table, params):
        assert table == "user_keys"
        user_id = params["user_id"][3:]
        self.reads.append(user_id)
        return self.rows.get(user_id)


class VaultTests(unittest.TestCase):
    def test_round_trip_reads_the_key_once(self):
        db = KeysDb({"u1": wrapped_row("u1")})
        vault = Vault(db, MASTER_B64, True)
        sealed = vault.seal("u1", SUBJECT, "Lunch on Friday?")
        self.assertTrue(is_ciphertext(sealed))
        self.assertEqual(vault.open("u1", SUBJECT, sealed), "Lunch on Friday?")
        self.assertEqual(vault.open("u1", SUBJECT, enc(SUBJECT, "From the sync worker")), "From the sync worker")
        self.assertEqual(db.reads, ["u1"])
        self.assertIsNone(vault.seal("u1", SUBJECT, None))

    def test_plaintext_and_none_pass_through_without_a_key_read(self):
        db = KeysDb({"u1": wrapped_row("u1")})
        vault = Vault(db, MASTER_B64, False)
        self.assertEqual(vault.open("u1", BODY, "Older plain row"), "Older plain row")
        self.assertIsNone(vault.open("u1", BODY, None))
        self.assertEqual(db.reads, [])

    def test_encrypt_off_writes_plaintext(self):
        vault = Vault(KeysDb({"u1": wrapped_row("u1")}), MASTER_B64, False)
        self.assertEqual(vault.seal("u1", SUMMARY, "A summary"), "A summary")

    def test_no_key_yet_writes_plaintext(self):
        db = KeysDb({})
        vault = Vault(db, MASTER_B64, True)
        self.assertEqual(vault.seal("u2", SUMMARY, "A summary"), "A summary")
        self.assertEqual(vault.seal("u2", SUMMARY, "Again"), "Again")
        self.assertEqual(db.reads, ["u2"])  # not asked again until MISSING_RECHECK_S has passed

    def test_a_key_that_cannot_be_unwrapped_is_not_written_around(self):
        from ai.vault import KeyUnavailable

        db = KeysDb({"u1": wrapped_row("u1", os.urandom(32))})  # wrapped with a different master key
        vault = Vault(db, MASTER_B64, True)
        with self.assertRaises(KeyUnavailable):
            vault.seal("u1", SUMMARY, "secret")
        with self.assertRaises(KeyUnavailable):
            vault.seal("u1", SUMMARY, "secret")  # still refused, not remembered as "no key"
        self.assertNotIn("u1", vault._missing)
        db.rows["u1"] = wrapped_row("u1")  # the key setup is fixed
        vault._unwrap_failed["u1"] = 0.0001  # the short retry window has passed
        self.assertTrue(is_ciphertext(vault.seal("u1", SUMMARY, "secret")))

    def test_failed_decrypt_is_empty(self):
        vault = Vault(KeysDb({"u1": wrapped_row("u1")}), MASTER_B64, True)
        self.assertEqual(vault.open("u1", SUBJECT, enc(BODY, "A body, not a subject")), "")
        self.assertEqual(vault.open("u1", SUBJECT, "e1:bm9wZQ=="), "")
        self.assertEqual(Vault(KeysDb({}), MASTER_B64).open("u2", SUBJECT, enc(SUBJECT, "Hi")), "")  # no key
        wrong = Vault(KeysDb({"u1": wrapped_row("u1", os.urandom(32))}), MASTER_B64)
        self.assertEqual(wrong.open("u1", SUBJECT, enc(SUBJECT, "Hi")), "")  # wrapped under another master key
        self.assertEqual(Vault(KeysDb({"u1": wrapped_row("u1")})).open("u1", SUBJECT, enc(SUBJECT, "Hi")), "")  # no KEY_WRAPPING_KEY

    def test_open_row_in_place(self):
        vault = Vault(KeysDb({"u1": wrapped_row("u1")}), MASTER_B64)
        row = {"id": "m1", "subject": enc(SUBJECT, "Hi"), "body_text": "plain", "body_html": None}
        out = vault.open_row("u1", row, [("subject", SUBJECT), ("body_text", BODY), ("body_html", HTML), ("missing", BODY)])
        self.assertIs(out, row)
        self.assertEqual(row, {"id": "m1", "subject": "Hi", "body_text": "plain", "body_html": None})
        self.assertIsNone(vault.open_row("u1", None, [("subject", SUBJECT)]))


TEAM_DATA_KEY = os.urandom(32)
TEAM_KEYS = derive_team_keys(TEAM_DATA_KEY)


def wrapped_team_row(workspace_id: str, master: bytes = MASTER) -> dict:
    """A team_keys row: local:v1, the workspace id bound in as team_keys:<id>."""
    iv = os.urandom(12)
    sealed = AESGCM(master).encrypt(iv, TEAM_DATA_KEY, f"team_keys:{workspace_id}".encode())
    return {"wrapped_key": base64.b64encode(iv + sealed).decode(), "wrapped_by": "local:v1"}


class TeamKeysDb:
    def __init__(self, users: dict, teams: dict, members: dict | None = None):
        self.users, self.teams = users, teams
        self.members = members or {}  # user_id -> workspace ids they are or were in, newest first
        self.reads: list[tuple[str, str]] = []

    def select(self, table, params):
        if table == "team_keys":
            owner = params["workspace_id"][3:]
            self.reads.append(("team", owner))
            rows = self.teams.get(owner)
            return [] if rows is None else (rows if isinstance(rows, list) else [rows])
        assert table == "workspace_members"
        owner = params["user_id"][3:]
        self.reads.append(("members", owner))
        return [{"workspace_id": w} for w in self.members.get(owner, [])]

    def first(self, table, params):
        if table == "user_keys":
            owner = params["user_id"][3:]
            self.reads.append(("user", owner))
            return self.users.get(owner)
        raise AssertionError(table)


class TeamVaultTests(unittest.TestCase):
    def team_enc(self, field: str, text: str) -> str:
        return encrypt_team_field(TEAM_KEYS, field, text)

    def test_opens_either_prefix_and_reads_each_key_once(self):
        db = TeamKeysDb({"u1": wrapped_row("u1")}, {"w1": wrapped_team_row("w1")})
        vault = Vault(db, MASTER_B64)
        self.assertEqual(vault.open("u1", SUBJECT, enc(SUBJECT, "Mine"), "w1"), "Mine")
        self.assertEqual(vault.open("u1", SUBJECT, self.team_enc(SUBJECT, "Shared"), "w1"), "Shared")
        self.assertEqual(vault.open("u1", SUBJECT, self.team_enc(SUBJECT, "Shared"), "w1"), "Shared")
        self.assertEqual(vault.open("u1", SUBJECT, "plain", "w1"), "plain")
        self.assertEqual(sorted(db.reads), [("team", "w1"), ("user", "u1")])

    def test_a_team_value_needs_the_rows_workspace(self):
        db = TeamKeysDb({"u1": wrapped_row("u1")}, {"w1": wrapped_team_row("w1")})
        vault = Vault(db, MASTER_B64)
        shared = self.team_enc(SUBJECT, "Shared")
        self.assertEqual(vault.open("u1", SUBJECT, shared), "")  # no workspace on the row, and the user is in none
        self.assertEqual(vault.open("u1", SUBJECT, shared, "w2"), "")  # a workspace with no key
        self.assertEqual(vault.open("u1", SUBJECT, self.team_enc(BODY, "A body"), "w1"), "")  # another field
        self.assertEqual(Vault(TeamKeysDb({}, {"w1": wrapped_team_row("w1", os.urandom(32))}), MASTER_B64).open("u1", SUBJECT, shared, "w1"), "")
        # A key wrapped for another workspace does not open under this one.
        self.assertEqual(Vault(TeamKeysDb({}, {"w3": wrapped_team_row("w1")}), MASTER_B64).open("u1", SUBJECT, shared, "w3"), "")

    def test_without_a_workspace_on_the_row_the_users_own_are_tried(self):
        # Most reads do not select workspace_id. A team value in a user's row is from a workspace they are or were in.
        db = TeamKeysDb({"u1": wrapped_row("u1")}, {"w1": wrapped_team_row("w1"), "w2": wrapped_team_row("w2", os.urandom(32))}, {"u1": ["w2", "w1"], "u2": ["w3"]})
        vault = Vault(db, MASTER_B64)
        shared = self.team_enc(SUBJECT, "Shared")
        self.assertEqual(vault.open("u1", SUBJECT, shared), "Shared")  # w2's key cannot be opened here, w1's does
        self.assertEqual(vault.open("u1", SUBJECT, shared), "Shared")
        self.assertEqual(db.reads.count(("members", "u1")), 1)  # cached
        self.assertEqual(vault.open("u2", SUBJECT, shared), "")  # a workspace with no key
        self.assertEqual(vault.open("u1", SUBJECT, self.team_enc(BODY, "A body")), "")  # another field of a team value

    def test_open_row_uses_the_rows_workspace_id(self):
        db = TeamKeysDb({"u1": wrapped_row("u1")}, {"w1": wrapped_team_row("w1")})
        vault = Vault(db, MASTER_B64)
        row = {"id": "m1", "workspace_id": "w1", "subject": self.team_enc(SUBJECT, "Shared"), "body_text": enc(BODY, "Mine")}
        vault.open_row("u1", row, [("subject", SUBJECT), ("body_text", BODY)])
        self.assertEqual((row["subject"], row["body_text"]), ("Shared", "Mine"))
        own = {"id": "m2", "subject": enc(SUBJECT, "Personal")}
        vault.open_row("u1", own, [("subject", SUBJECT)])
        self.assertEqual(own["subject"], "Personal")


def team_row(workspace_id: str, data_key: bytes, version: int, retired: bool = False, master: bytes = MASTER) -> dict:
    iv = os.urandom(12)
    sealed = AESGCM(master).encrypt(iv, data_key, f"team_keys:{workspace_id}".encode())
    return {"key_version": version, "wrapped_key": base64.b64encode(iv + sealed).decode(), "wrapped_by": "local:v1", "retired_at": "2026-11-02T00:00:00Z" if retired else None}


class TeamRotationTests(unittest.TestCase):
    """A rotation makes version 2; the AI worker opens values sealed under either until the sync worker has re-sealed."""

    K1, K2 = bytes(range(32, 64)), bytes(range(64, 96))

    def sealed_under(self, data_key: bytes, field: str, text: str, index_root: bytes) -> str:
        keys = derive_team_keys(data_key)
        return encrypt_team_field(type(keys)(enc=keys.enc, index=derive_team_keys(index_root).index), field, text)

    def test_opens_both_versions_and_keeps_the_index_from_the_first(self):
        rows = [team_row("w1", self.K1, 1), team_row("w1", self.K2, 2)]
        vault = Vault(TeamKeysDb({}, {"w1": rows}), MASTER_B64)
        old = self.sealed_under(self.K1, SUBJECT, "Sealed before", self.K1)
        new = self.sealed_under(self.K2, SUBJECT, "Sealed after", self.K1)
        self.assertEqual(vault.open("u", SUBJECT, old, "w1"), "Sealed before")
        self.assertEqual(vault.open("u", SUBJECT, new, "w1"), "Sealed after")
        ring = vault.team_keyring_for("w1")
        self.assertEqual(len(ring), 2)
        self.assertEqual(ring[0].enc, derive_team_keys(self.K2).enc)  # the current version first
        self.assertEqual(ring[0].index, derive_team_keys(self.K1).index)  # the index never moves

    def test_a_retired_version_no_longer_opens_anything(self):
        rows = [team_row("w1", self.K1, 1, retired=True), team_row("w1", self.K2, 2)]
        vault = Vault(TeamKeysDb({}, {"w1": rows}), MASTER_B64)
        self.assertEqual(vault.open("u", SUBJECT, self.sealed_under(self.K1, SUBJECT, "Old", self.K1), "w1"), "")
        self.assertEqual(vault.open("u", SUBJECT, self.sealed_under(self.K2, SUBJECT, "New", self.K1), "w1"), "New")
        self.assertEqual(len(vault.team_keyring_for("w1")), 1)

    def test_keys_are_read_again_after_their_cache_time(self):
        db = TeamKeysDb({"u1": wrapped_row("u1")}, {})
        vault = Vault(db, MASTER_B64)
        vault.open("u1", SUBJECT, enc(SUBJECT, "x"))
        self.assertEqual(db.reads.count(("user", "u1")), 1)
        vault._keys["u1"] = (0.0, vault._keys["u1"][1])  # aged out
        vault.open("u1", SUBJECT, enc(SUBJECT, "x"))
        self.assertEqual(db.reads.count(("user", "u1")), 2)


class EncryptedTriageDb(FakeTriageDb):
    """FakeTriageDb with encrypted subjects and bodies, and a user_keys row for user u."""

    def first(self, table, params):
        return wrapped_row("u") if table == "user_keys" else None

    def select(self, table, params):
        rows = super().select(table, params)
        if params.get("select") == "id,body_text,body_html":
            return [{**r, "body_text": enc(BODY, r["body_text"])} for r in rows]
        return rows


class EncryptedTriage(unittest.TestCase):
    def msg(self, mid, thread, subject):
        return {"id": mid, "user_id": "u", "account_id": "acc1", "thread_id": thread, "provider_message_id": f"<{mid}@x>", "subject": enc(SUBJECT, subject),
                "sender_address": "sam@x.com", "sender_contact_id": None, "list_unsubscribe": enc("unsubscribe", "<mailto:x@y>"), "sent_at": "2026-10-20T10:00:00+00:00"}

    def test_opens_before_asking_and_seals_what_it_writes(self):
        pending = [self.msg("m1", "t1", "Lunch Friday"), self.msg("m2", "t2", "Big sale")]
        rows = [{"id": m["id"], "thread_id": m["thread_id"], "direction": "inbound"} for m in pending]
        db = EncryptedTriageDb(pending, rows, feedback=[{"thread_id": "t2", "value": "junk"}])
        gemini = FakeTriageGemini()
        self.assertEqual(Triage(db, gemini, "fast", Vault(db, MASTER_B64, True)).run_once(), 2)
        [(prompt, _, _)] = gemini.calls
        self.assertIn("Subject: Lunch Friday", prompt)
        self.assertIn("Body of m1", prompt)
        self.assertIn("Bulk mail with an unsubscribe header: yes", prompt)
        self.assertNotIn("e1:", prompt)
        by_id = {r["message_id"]: r for r in db.upserts[0][1]}
        opened = Vault(db, MASTER_B64)
        self.assertEqual(opened.open("u", SUMMARY, by_id["m1"]["summary"]), "s1")
        # A junk conversation copies the subject into the summary: the plain subject, sealed once.
        self.assertTrue(is_ciphertext(by_id["m2"]["summary"]))
        self.assertEqual(opened.open("u", SUMMARY, by_id["m2"]["summary"]), "Big sale")
        self.assertEqual(opened.open("u", SUMMARY, db.thread_updates["t1"]["summary"]), "s1")


class DraftsDb:
    def __init__(self, draft: dict | None = None, choices: str | None = None):
        self.updates: list[tuple[str, dict, dict]] = []
        self.draft = draft or {"id": "d1", "user_id": "u", "thread_id": "t1", "tone": "default", "instruction": enc(INSTRUCTION, "Say Friday works")}
        self.choices = choices

    def first(self, table, params):
        return wrapped_row("u") if table == "user_keys" else None

    def select(self, table, params):
        if table == "drafts":
            return [self.draft]
        return []

    def rpc(self, function, args):
        if function != "draft_context":
            return []
        return {
            "thread": {"id": "t1", "user_id": "u", "account_id": "a1", "subject": enc(SUBJECT, "Lunch")},
            "messages": [{"id": "m1", "direction": "inbound", "sender_contact_id": None, "subject": enc(SUBJECT, "Lunch"),
                          "body_text": None, "body_html": enc(HTML, "<p>Free on Friday?</p>"), "sent_at": "2026-10-20T10:00:00+00:00"}],
            "profile": None,
            "rules": [],
            "examples": [],
            "recent": [{"body_text": enc(BODY, "Cheers, Matt"), "body_html": None}],
            "contact": None,
            "to_them": [],
            "choices": enc(CHOICES, self.choices) if self.choices else None,
        }

    def update(self, table, filters, patch, minimal=False):
        self.updates.append((table, filters, patch))
        return [{"id": "d1"}]


class DraftsGemini:
    def __init__(self):
        self.prompts: list[str] = []

    def json(self, model, system, prompt, schema, usage, **kw):
        self.prompts.append(prompt)
        return {"body": "Friday works, see you then."}


class FakeIndex:
    def replies(self, user_id, query, exclude_thread, limit):
        return [{"thread_id": "t9", "similarity": 0.9, "inbound_text": enc(BODY, "Lunch on Tuesday?"), "reply_text": enc(BODY, "Tuesday is good, Matt")}]


class FakeEmbeddings:
    """What Drafts needs of Embeddings: the stored vector of the newest incoming mail and the search."""
    index = FakeIndex()

    def stored(self, user_id, message_id):
        return [1.0, 0.0]


class EncryptedDrafts(unittest.TestCase):
    def test_opens_the_conversation_and_instruction_and_seals_the_draft(self):
        db, gemini = DraftsDb(), DraftsGemini()
        vault = Vault(db, MASTER_B64, True)
        drafts = Drafts(db, gemini, "m", FakeEmbeddings(), vault)
        self.assertEqual(drafts.run_once(), 1)
        drafts._runner.shutdown(wait=True)
        [prompt] = gemini.prompts
        self.assertIn("Free on Friday?", prompt)
        self.assertIn("Cheers, Matt", prompt)
        self.assertIn("Tuesday is good, Matt", prompt)  # a similar reply found by the worker's own search, opened
        self.assertIn("Their instruction for this reply: Say Friday works", prompt)
        self.assertNotIn("e1:", prompt)
        [written] = [p for t, f, p in db.updates if t == "drafts" and p.get("status") == "active"]
        self.assertTrue(is_ciphertext(written["body"]))
        self.assertEqual(Vault(db, MASTER_B64).open("u", DRAFT, written["body"]), "Friday works, see you then.")


class VoiceDb(DraftsDb):
    def __init__(self, clip: bytes):
        super().__init__({"id": "d1", "user_id": "u", "thread_id": "t1", "tone": "default", "status": "pending", "instruction": None, "audio_path": "u/drafts/abc.webm"})
        self.clip = clip
        self.removed: list[str] = []

    def download(self, bucket, path):
        return self.clip

    def remove_files(self, bucket, paths):
        self.removed += paths


class VoiceGemini(DraftsGemini):
    def json(self, model, system, prompt, schema, usage, **kw):
        self.prompts.append(prompt)
        self.audio = kw.get("audio")
        return {"said": "tell him friday works and I'll bring the keys", "body": "Friday works, I'll bring the keys."}


class VoiceDrafts(unittest.TestCase):
    def test_hears_the_recording_keeps_what_was_said_and_deletes_it(self):
        db = VoiceDb(b"")
        db.clip = encrypt_bytes(Vault(db, MASTER_B64).keys_for("u"), VOICE_INSTRUCTION, b"opus audio")
        gemini = VoiceGemini()
        drafts = Drafts(db, gemini, "m", None, Vault(db, MASTER_B64, True))
        drafts._write(db.draft)
        self.assertEqual(gemini.audio, (b"opus audio", "audio/webm"))
        self.assertIn("What they want this reply to say is in their recording", gemini.prompts[0])
        [written] = [p for t, f, p in db.updates if p.get("status") == "active"]
        opened = Vault(db, MASTER_B64)
        self.assertEqual(opened.open("u", INSTRUCTION, written["instruction"]), "tell him friday works and I'll bring the keys")
        self.assertEqual(opened.open("u", DRAFT, written["body"]), "Friday works, I'll bring the keys.")
        drafts._draft({**db.draft})  # the whole job, with its clean-up
        self.assertEqual(db.removed, ["u/drafts/abc.webm"])
        self.assertIn(("drafts", {"id": "eq.d1"}, {"audio_path": None}), db.updates)

    def test_a_recording_that_cannot_be_opened_fails_the_draft(self):
        db, gemini = VoiceDb(b"e1b:\x00\xffKN" + bytes(40)), VoiceGemini()
        Drafts(db, gemini, "m", None, Vault(db, MASTER_B64, True))._draft(db.draft)
        self.assertEqual(gemini.prompts, [])
        self.assertTrue(any(p.get("status") == "failed" for _, _, p in db.updates))
        self.assertEqual(db.removed, ["u/drafts/abc.webm"])


class ComposeDb(DraftsDb):
    def __init__(self, draft):
        super().__init__(draft)
        self.calls: list[str] = []

    def rpc(self, function, args):
        self.calls.append(function)
        if function != "compose_context":
            return {}
        return {
            "account": {"id": "a1", "user_id": "u", "channel": self.channel},
            "profile": {"display_name": "Matt", "about": None},
            "rules": [],
            "facts": [],
            "examples": [],
            "recent": [{"body_text": enc(BODY, "Cheers, Matt"), "body_html": None}],
            "contact": {"id": "c1", "display_name": "Sam", "relationship": "client"},
            "to_them": [],
        }


class ComposeGemini(DraftsGemini):
    def json(self, model, system, prompt, schema, usage, **kw):
        self.prompts.append(prompt)
        self.schema, self.system = schema, system
        return {"subject": "Viewing on Thursday", "body": "Hi Sam, are you free to view the flat on Thursday? Matt"}


class ComposeDrafts(unittest.TestCase):
    def run_compose(self, channel, **draft):
        db = ComposeDb({"id": "d1", "user_id": "u", "thread_id": None, "account_id": "a1", "contact_id": "c1", "tone": "custom",
                        "status": "pending", "instruction": "ask Sam about viewing the flat on Thursday", **draft})
        db.channel = channel
        gemini = ComposeGemini()
        Drafts(db, gemini, "m", None, Vault(db, MASTER_B64, True))._write(db.draft)
        return db, gemini

    def test_a_new_email_gets_a_subject_and_no_conversation(self):
        db, gemini = self.run_compose("email")
        self.assertEqual(db.calls, ["compose_context"])
        self.assertRegex(gemini.prompts[0], r"Writing to \(name[^\n]*\n<<<UNTRUSTED-[0-9a-f]+\nSam\nUNTRUSTED-")
        self.assertIn("A new email message, not a reply", gemini.prompts[0])
        self.assertTrue(gemini.prompts[0].rstrip().endswith("Write their new email message to the person named above, with its subject."))
        self.assertIn("subject", gemini.schema["properties"])
        self.assertIn("This starts a conversation", gemini.system)
        [written] = [p for t, f, p in db.updates if p.get("status") == "active"]
        self.assertEqual(Vault(db, MASTER_B64).open("u", SUBJECT, written["subject"]), "Viewing on Thursday")
        # Nothing else is replaced: a new message has no conversation.
        self.assertEqual([f for t, f, p in db.updates if "thread_id" in f], [])

    def test_a_new_whatsapp_message_has_no_subject(self):
        db, gemini = self.run_compose("whatsapp")
        self.assertNotIn("subject", gemini.schema["properties"])
        [written] = [p for t, f, p in db.updates if p.get("status") == "active"]
        self.assertNotIn("subject", written)

    def test_nothing_to_say_fails_without_asking_the_model(self):
        db, gemini = self.run_compose("email", instruction=None)
        self.assertEqual(gemini.prompts, [])
        self.assertTrue(any(p.get("status") == "failed" for _, _, p in db.updates))


class PreDrafts(unittest.TestCase):
    def run_draft(self, draft, choices=None):
        db, gemini = DraftsDb({"user_id": "u", "thread_id": "t1", "tone": "default", "auto": True, **draft}, choices), DraftsGemini()
        drafts = Drafts(db, gemini, "m", None, Vault(db, MASTER_B64, True))
        drafts.run_once()
        drafts._runner.shutdown(wait=True)
        db.updates = [u for u in db.updates if "created_at" not in u[1]]  # not the sweep for drafts pending too long
        return db, gemini

    def test_written_and_replaces_older_drafts_as_expired(self):
        db, gemini = self.run_draft({"id": "d2", "for_message_id": "m1"})
        self.assertEqual(len(gemini.prompts), 1)
        self.assertEqual([p["status"] for t, f, p in db.updates], ["active", "expired"])

    def test_dropped_without_the_model_when_a_newer_message_came(self):
        db, gemini = self.run_draft({"id": "d2", "for_message_id": "m0"})
        self.assertEqual(gemini.prompts, [])
        self.assertEqual([(f["id"], p["status"]) for t, f, p in db.updates], [("eq.d2", "expired")])

    def test_dropped_when_the_message_has_choices(self):
        db, gemini = self.run_draft({"id": "d2", "for_message_id": "m1"}, '{"options": [{"kind": "accept", "label": "Yes"}]}')
        self.assertEqual(gemini.prompts, [])
        self.assertEqual([p["status"] for t, f, p in db.updates], ["expired"])


class LearnDb:
    def __init__(self):
        self.inserts: list[tuple[str, dict]] = []

    def first(self, table, params):
        if table == "user_keys":
            return wrapped_row("u")
        return {"account_id": "a1", "user_id": "u"} if table == "threads" else None

    def select(self, table, params):
        if table == "drafts" and "body" in params["select"]:
            # Both pass body=neq. on the server, as ciphertext is never ''. d1 is empty once opened.
            return [{"id": "d1", "user_id": "u", "thread_id": "t1", "body": enc(DRAFT, ""), "created_at": "2026-10-20T10:00:00+00:00"},
                    {"id": "d2", "user_id": "u", "thread_id": "t2", "body": enc(DRAFT, "Dear Sam, Friday suits me."), "created_at": "2026-10-20T10:00:00+00:00"}]
        if table == "messages":
            return [{"id": "m1", "user_id": "u", "thread_id": t, "body_text": enc(BODY, "Friday works. Matt"), "body_html": None, "sent_at": "2026-10-20T11:00:00+00:00"}
                    for t in ("t1", "t2")]
        return []

    def insert(self, table, rows):
        self.inserts.append((table, rows))
        return []


class LearnGemini:
    def __init__(self):
        self.prompts: list[str] = []

    def json(self, model, system, prompt, schema, usage, **kw):
        self.prompts.append(prompt)
        return {"rules": []}


class EncryptedLearning(unittest.TestCase):
    def test_rewrites_skip_empty_drafts_and_seal_the_outcome(self):
        db, gemini = LearnDb(), LearnGemini()
        self.assertEqual(Learn(db, gemini, "m", Vault(db, MASTER_B64, True))._rewrites(), 1)
        [(table, row)] = db.inserts
        self.assertEqual((table, row["draft_id"]), ("draft_outcomes", "d2"))
        opened = Vault(db, MASTER_B64)
        self.assertEqual(opened.open("u", DRAFT, row["draft_body"]), "Dear Sam, Friday suits me.")
        self.assertEqual(opened.open("u", BODY, row["sent_body"]), "Friday works. Matt")
        [prompt] = gemini.prompts
        self.assertIn("Dear Sam, Friday suits me.", prompt)
        self.assertNotIn("e1:", prompt)


if __name__ == "__main__":
    unittest.main()
