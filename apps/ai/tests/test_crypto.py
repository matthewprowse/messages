import json
import unittest
from pathlib import Path

from ai.crypto import address_key, blind_index, chat_key, domain_key, decrypt_field, derive_user_keys, encrypt_field, encrypt_optional, is_ciphertext

VECTORS = json.loads((Path(__file__).resolve().parents[3] / "packages" / "crypto" / "vectors.json").read_text())
KEYS = derive_user_keys(bytes.fromhex(VECTORS["dataKeyHex"]))


class SharedFormat(unittest.TestCase):
    def test_matches_the_typescript_vectors(self):
        for v in VECTORS["fields"]:
            self.assertEqual(encrypt_field(KEYS, v["field"], v["plaintext"], bytes(v["nonce"])), v["ciphertext"])
            self.assertEqual(decrypt_field(KEYS, v["field"], v["ciphertext"]), v["plaintext"])

    def test_blind_indexes_match(self):
        for v in VECTORS["blindIndexes"]:
            self.assertEqual(blind_index(KEYS, v["value"]), v["token"])

    def test_address_keys_match(self):
        rule = {"address": address_key, "chat": chat_key, "domain": domain_key}
        for v in VECTORS["addressKeys"]:
            self.assertEqual(rule[v["kind"]](v["value"]), v["key"], v["value"])

    def test_moved_or_altered_values_fail(self):
        v = VECTORS["fields"][0]
        with self.assertRaises(Exception):
            decrypt_field(KEYS, "messages.subject", v["ciphertext"])
        with self.assertRaises(Exception):
            decrypt_field(derive_user_keys(bytes(32)), v["field"], v["ciphertext"])

    def test_round_trip_and_nulls(self):
        c = encrypt_field(KEYS, "threads.summary", "Lunch on Friday?")
        self.assertTrue(is_ciphertext(c))
        self.assertEqual(decrypt_field(KEYS, "threads.summary", c), "Lunch on Friday?")
        self.assertIsNone(encrypt_optional(KEYS, "threads.summary", None))


class Unwrap(unittest.TestCase):
    def test_unwraps_a_key_the_typescript_side_wrapped(self):
        from ai.keys import unwrap
        w = VECTORS["localWrap"]
        key = unwrap({"wrapped_by": "local:v1", "wrapped_key": w["wrapped"]}, w["masterKeyBase64"], w["userId"])
        self.assertEqual(key.hex(), VECTORS["dataKeyHex"])
        with self.assertRaises(Exception):
            unwrap({"wrapped_by": "local:v1", "wrapped_key": w["wrapped"]}, w["masterKeyBase64"], "someone-else")
