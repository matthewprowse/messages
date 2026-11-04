"""Tests for the bound value format in ai.crypto against packages/crypto/bound-vectors.json, so Python seals and opens
"e2:", "t2:" and "e2b:" byte for byte like the TypeScript side; a value opens only for its owner, field, place and row;
the outbox swap attack of the security audit (H4) fails; and the strict readers refuse what they must."""

import base64
import json
import os
import unittest
from pathlib import Path

from ai.crypto import (
    BoundError, decrypt_bytes, decrypt_field, decrypt_team_bytes, decrypt_team_field, derive_team_keys, derive_user_keyring, derive_user_keys, encrypt_at, encrypt_bytes,
    encrypt_bytes_at, encrypt_field, encrypt_team_at, is_ciphertext, is_legacy_ciphertext, is_sealed_bytes, is_team_ciphertext, open_expected, open_file_expected, place_of,
)

V = json.loads((Path(__file__).resolve().parents[3] / "packages" / "crypto" / "bound-vectors.json").read_text())
KEYS = derive_user_keys(bytes.fromhex(V["dataKeyHex"]), V["userId"])
TEAM = derive_team_keys(bytes.fromhex(V["teamDataKeyHex"]), V["workspaceId"])
OUTBOX = "caabe3e9-0000-4000-8000-0000000000b1"


class BoundVectors(unittest.TestCase):
    def test_fields_match_the_typescript_vectors_and_open(self):
        for c in V["fields"]:
            self.assertEqual(encrypt_at(KEYS, c["field"], c["place"], c["row"], c["plaintext"], bytes(c["nonce"])), c["ciphertext"])
            self.assertEqual(decrypt_field(KEYS, c["field"], c["ciphertext"]), c["plaintext"])
            self.assertEqual(place_of(c["ciphertext"]), (c["place"], c["row"]))
        for c in V["teamFields"]:
            self.assertEqual(encrypt_team_at(TEAM, c["field"], c["place"], c["row"], c["plaintext"], bytes(c["nonce"])), c["ciphertext"])
            self.assertEqual(decrypt_team_field(TEAM, c["field"], c["ciphertext"]), c["plaintext"])
            self.assertTrue(is_team_ciphertext(c["ciphertext"]) and not is_legacy_ciphertext(c["ciphertext"]))

    def test_files_match_the_typescript_vectors_and_open_only_where_they_were_sealed(self):
        for f in V["files"]:
            plain = bytes.fromhex(f["plainHex"])
            keys = KEYS if f["owner"] == "user" else TEAM
            sealed = encrypt_bytes_at(keys, f["field"], f["where"], plain, bytes(f["nonce"]))
            self.assertEqual(sealed.hex(), f["sealedHex"])
            self.assertTrue(is_sealed_bytes(sealed))
            opened = decrypt_bytes(KEYS, f["field"], sealed, f["where"]) if f["owner"] == "user" else decrypt_team_bytes(TEAM, f["field"], sealed, f["where"])
            self.assertEqual(opened, plain)
        f = V["files"][0]
        sealed = bytes.fromhex(f["sealedHex"])
        with self.assertRaises(Exception):
            decrypt_bytes(KEYS, f["field"], sealed, f["where"].replace("c1/file", "c2/file"))
        with self.assertRaises(BoundError):
            decrypt_bytes(KEYS, f["field"], sealed)

    def test_a_value_opens_only_for_its_user_field_and_untouched_place(self):
        c = V["fields"][0]
        with self.assertRaises(Exception):
            decrypt_field(derive_user_keys(bytes.fromhex(V["dataKeyHex"]), "caabe3e9-0000-4000-8000-000000000002"), c["field"], c["ciphertext"])
        with self.assertRaises(BoundError):
            decrypt_field(derive_user_keys(bytes.fromhex(V["dataKeyHex"])), c["field"], c["ciphertext"])
        with self.assertRaises(Exception):
            decrypt_field(KEYS, "subject", c["ciphertext"])
        raw = bytearray(base64.b64decode(c["ciphertext"][3:]))
        raw[1] = ord("i")
        with self.assertRaises(Exception):
            decrypt_field(KEYS, c["field"], "e2:" + base64.b64encode(bytes(raw)).decode())


class StrictReads(unittest.TestCase):
    def strict(self, value, field="body", places=("outbox.body",), row=OUTBOX, sealed=True, legacy=False):
        return open_expected(KEYS, field, value, list(places), row, sealed, legacy)

    def test_the_outbox_swap_attack_fails(self):
        message_body = encrypt_at(KEYS, "body", "messages.body_text", None, "Bank details: 123")
        forged_id = "caabe3e9-0000-4000-8000-0000000000f1"
        with self.assertRaises(BoundError) as e:
            self.strict(message_body, row=forged_id)
        self.assertEqual(e.exception.code, "sealed_elsewhere")
        with self.assertRaises(BoundError) as e:
            self.strict("attacker@example.com", field="address", places=("outbox.to_addresses",), row=forged_id)
        self.assertEqual(e.exception.code, "plaintext_refused")
        real = encrypt_at(KEYS, "body", "outbox.body", OUTBOX, "Hello")
        self.assertEqual(self.strict(real), "Hello")
        with self.assertRaises(BoundError):
            self.strict(real, row=forged_id)
        legacy = encrypt_field(KEYS, "body", "Bank details: 123")
        with self.assertRaises(BoundError) as e:
            self.strict(legacy)
        self.assertEqual(e.exception.code, "legacy_value")
        self.assertEqual(self.strict(legacy, legacy=True), "Bank details: 123")

    def test_team_unplaced_and_plain_values(self):
        with self.assertRaises(BoundError) as e:
            self.strict(encrypt_team_at(TEAM, "body", "outbox.body", OUTBOX, "Hi"), legacy=True)
        self.assertEqual(e.exception.code, "team_value_refused")
        with self.assertRaises(BoundError):
            self.strict(encrypt_at(KEYS, "body", "", None, "Hi"))
        self.assertEqual(self.strict("plain", sealed=False), "plain")
        self.assertIsNone(self.strict(None))

    def test_files_check_the_sealed_flag_and_refuse_plain_or_legacy_files(self):
        where = "attachments/u/outbox/f/file"
        bound = encrypt_bytes_at(KEYS, "outbox_file_data", where, b"\x01\x02")
        self.assertEqual(open_file_expected(KEYS, "outbox_file_data", bound, where, True, False), b"\x01\x02")
        for data, flagged in ((bound, False), (b"\x01\x02", True)):
            with self.assertRaises(BoundError) as e:
                open_file_expected(KEYS, "outbox_file_data", data, where, True, False, flagged)
            self.assertEqual(e.exception.code, "sealed_mismatch")
        with self.assertRaises(BoundError):
            open_file_expected(KEYS, "outbox_file_data", b"\x01", where, True, False)
        self.assertEqual(open_file_expected(KEYS, "outbox_file_data", b"\x01", where, False, False), b"\x01")
        legacy = encrypt_bytes(KEYS, "outbox_file_data", b"\x03")
        with self.assertRaises(BoundError):
            open_file_expected(KEYS, "outbox_file_data", legacy, where, True, False)
        self.assertEqual(open_file_expected(KEYS, "outbox_file_data", legacy, where, True, True), b"\x03")

    def test_a_rotated_keyring_opens_bound_values_under_either_key(self):
        previous, current = os.urandom(32), os.urandom(32)
        old = encrypt_at(derive_user_keys(previous, V["userId"]), "body", "outbox.body", OUTBOX, "Moved")
        ring = derive_user_keyring(current, [previous], None, V["userId"])
        self.assertEqual(decrypt_field(ring, "body", old), "Moved")
        self.assertTrue(is_ciphertext(old) and not is_legacy_ciphertext(old))


if __name__ == "__main__":
    unittest.main()
