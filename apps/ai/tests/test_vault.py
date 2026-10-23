import base64
import os
import unittest

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from ai.crypto import derive_user_keys, encrypt_field, is_ciphertext
from ai.drafts import Drafts
from ai.fields import BODY, DRAFT, HTML, INSTRUCTION, SUBJECT, SUMMARY
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
    def __init__(self):
        self.updates: list[tuple[str, dict, dict]] = []

    def first(self, table, params):
        if table == "user_keys":
            return wrapped_row("u")
        if table == "threads":
            return {"id": "t1", "user_id": "u", "account_id": "a1", "subject": enc(SUBJECT, "Lunch")}
        return None

    def select(self, table, params):
        if table == "drafts":
            return [{"id": "d1", "user_id": "u", "thread_id": "t1", "tone": "default", "instruction": enc(INSTRUCTION, "Say Friday works")}]
        if table == "messages" and params.get("direction") == "eq.outbound":
            return [{"body_text": enc(BODY, "Cheers, Matt"), "body_html": None}]
        if table == "messages":
            return [{"id": "m1", "direction": "inbound", "sender_contact_id": None, "subject": enc(SUBJECT, "Lunch"),
                     "body_text": None, "body_html": enc(HTML, "<p>Free on Friday?</p>"), "sent_at": "2026-10-20T10:00:00+00:00"}]
        return []

    def update(self, table, filters, patch, minimal=False):
        self.updates.append((table, filters, patch))
        return [{"id": "d1"}]


class DraftsGemini:
    def __init__(self):
        self.prompts: list[str] = []

    def json(self, model, system, prompt, schema, usage, **kw):
        self.prompts.append(prompt)
        return {"body": "Friday works, see you then."}


class EncryptedDrafts(unittest.TestCase):
    def test_opens_the_conversation_and_instruction_and_seals_the_draft(self):
        db, gemini = DraftsDb(), DraftsGemini()
        drafts = Drafts(db, gemini, "m", None, Vault(db, MASTER_B64, True))
        self.assertEqual(drafts.run_once(), 1)
        drafts._runner.shutdown(wait=True)
        [prompt] = gemini.prompts
        self.assertIn("Free on Friday?", prompt)
        self.assertIn("Cheers, Matt", prompt)
        self.assertIn("Their instruction for this reply: Say Friday works", prompt)
        self.assertNotIn("e1:", prompt)
        [written] = [p for t, f, p in db.updates if t == "drafts" and p.get("status") == "active"]
        self.assertTrue(is_ciphertext(written["body"]))
        self.assertEqual(Vault(db, MASTER_B64).open("u", DRAFT, written["body"]), "Friday works, see you then.")


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
