"""Tests for ai.crypto against the shared vectors in packages/crypto/vectors.json, so the Python and TypeScript sides stay
byte-compatible: field encryption, blind indexes, address keys, team keys, sealed files and key unwrapping."""

import json
import unittest
from pathlib import Path

from ai.crypto import (
    KeySet, address_key, blind_index, chat_key, decrypt_any, decrypt_bytes, decrypt_field, decrypt_team_field, derive_team_keys, derive_user_keys, domain_key, group_name_key,
    encrypt_bytes, encrypt_field, encrypt_optional, encrypt_team_field, is_ciphertext, is_team_ciphertext, team_address_index, team_blind_index, team_domain_index,
)

VECTORS = json.loads((Path(__file__).resolve().parents[3] / "packages" / "crypto" / "vectors.json").read_text())
KEYS = derive_user_keys(bytes.fromhex(VECTORS["dataKeyHex"]))
TEAM_KEYS = derive_team_keys(bytes.fromhex(VECTORS["teamDataKeyHex"]))


class SharedFormat(unittest.TestCase):
    def test_matches_the_typescript_vectors(self):
        for v in VECTORS["fields"]:
            self.assertEqual(encrypt_field(KEYS, v["field"], v["plaintext"], bytes(v["nonce"])), v["ciphertext"])
            self.assertEqual(decrypt_field(KEYS, v["field"], v["ciphertext"]), v["plaintext"])

    def test_blind_indexes_match(self):
        for v in VECTORS["blindIndexes"]:
            self.assertEqual(blind_index(KEYS, v["value"]), v["token"])

    def test_address_keys_match(self):
        rule = {"address": address_key, "chat": chat_key, "domain": domain_key, "group": group_name_key}
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


class TeamFormat(unittest.TestCase):
    def test_matches_the_typescript_team_vectors(self):
        for v in VECTORS["teamFields"]:
            self.assertTrue(v["ciphertext"].startswith("t1:"))
            self.assertEqual(encrypt_team_field(TEAM_KEYS, v["field"], v["plaintext"], bytes(v["nonce"])), v["ciphertext"])
            self.assertEqual(decrypt_team_field(TEAM_KEYS, v["field"], v["ciphertext"]), v["plaintext"])

    def test_team_blind_indexes_match_and_never_equal_a_users(self):
        for v in VECTORS["teamBlindIndexes"]:
            self.assertEqual(team_blind_index(TEAM_KEYS, address_key(v["value"])), v["token"])
            self.assertEqual(team_address_index(TEAM_KEYS, v["value"]), v["token"])
            self.assertNotEqual(blind_index(KEYS, address_key(v["value"])), v["token"])
        self.assertEqual(team_address_index(TEAM_KEYS, " Sam@Example.com "), team_address_index(TEAM_KEYS, "sam@example.com"))
        self.assertEqual(team_address_index(TEAM_KEYS, "+27 82 416 0503"), team_address_index(TEAM_KEYS, "27824160503"))
        self.assertEqual(team_domain_index(TEAM_KEYS, "@Example.co.za"), team_blind_index(TEAM_KEYS, "domain:example.co.za"))
        same = bytes.fromhex(VECTORS["dataKeyHex"])  # the same data key, under the team's HKDF info, is another key
        self.assertNotEqual(team_blind_index(derive_team_keys(same), "sam@example.com"), blind_index(KEYS, "sam@example.com"))

    def test_each_key_opens_only_its_own_prefix(self):
        user, team = VECTORS["fields"][0], VECTORS["teamFields"][0]
        self.assertTrue(is_ciphertext(team["ciphertext"]) and is_team_ciphertext(team["ciphertext"]))
        self.assertTrue(is_ciphertext(user["ciphertext"]) and not is_team_ciphertext(user["ciphertext"]))
        with self.assertRaises(Exception):
            decrypt_field(KEYS, team["field"], team["ciphertext"])
        with self.assertRaises(Exception):
            decrypt_team_field(TEAM_KEYS, user["field"], user["ciphertext"])
        with self.assertRaises(Exception):
            decrypt_team_field(TEAM_KEYS, user["field"], "t1:" + user["ciphertext"][3:])
        with self.assertRaises(Exception):
            decrypt_field(KEYS, team["field"], "e1:" + team["ciphertext"][3:])
        with self.assertRaises(Exception):
            decrypt_team_field(TEAM_KEYS, "messages.subject", team["ciphertext"])
        with self.assertRaises(Exception):
            decrypt_team_field(derive_team_keys(bytes(32)), team["field"], team["ciphertext"])

    def test_decrypt_any_picks_the_key_by_prefix(self):
        user, team = VECTORS["fields"][0], VECTORS["teamFields"][0]
        both = KeySet(user=KEYS, team=TEAM_KEYS)
        self.assertEqual(decrypt_any(both, user["field"], user["ciphertext"]), user["plaintext"])
        self.assertEqual(decrypt_any(both, team["field"], team["ciphertext"]), team["plaintext"])
        self.assertEqual(decrypt_any(KeySet(team=TEAM_KEYS), team["field"], team["ciphertext"]), team["plaintext"])
        with self.assertRaisesRegex(ValueError, "team's keys"):
            decrypt_any(KeySet(user=KEYS), team["field"], team["ciphertext"])
        with self.assertRaisesRegex(ValueError, "user's keys"):
            decrypt_any(KeySet(team=TEAM_KEYS), user["field"], user["ciphertext"])

    def test_round_trip(self):
        c = encrypt_team_field(TEAM_KEYS, "threads.summary", "Lunch on Friday?")
        self.assertTrue(is_team_ciphertext(c))
        self.assertNotEqual(c, encrypt_team_field(TEAM_KEYS, "threads.summary", "Lunch on Friday?"))
        self.assertEqual(decrypt_team_field(TEAM_KEYS, "threads.summary", c), "Lunch on Friday?")
        self.assertTrue(encrypt_field(KEYS, "threads.summary", "Hi").startswith("e1:"))


class SealedFiles(unittest.TestCase):
    # encryptBytes in packages/crypto with data key 0..31, nonce 100..111, field voice_instruction.
    TS = bytes.fromhex("6531623a00ff4b4e6465666768696a6b6c6d6e6f7f2d066b3e84b18bf28913f0d7f13d5196e1c4fee3")

    def test_opens_what_the_typescript_side_sealed(self):
        keys = derive_user_keys(bytes(range(32)))
        self.assertEqual(decrypt_bytes(keys, "voice_instruction", self.TS), bytes([1, 2, 3, 250, 251]))
        self.assertEqual(encrypt_bytes(keys, "voice_instruction", bytes([1, 2, 3, 250, 251]), bytes(range(100, 112))), self.TS)

    def test_another_field_or_altered_bytes_fail(self):
        keys = derive_user_keys(bytes(range(32)))
        with self.assertRaises(Exception):
            decrypt_bytes(keys, "note_file_data", self.TS)
        with self.assertRaises(Exception):
            decrypt_bytes(keys, "voice_instruction", self.TS[:-1] + bytes([self.TS[-1] ^ 1]))
        with self.assertRaises(ValueError):
            decrypt_bytes(keys, "voice_instruction", b"not sealed at all, just audio")


class Unwrap(unittest.TestCase):
    def test_unwraps_a_key_the_typescript_side_wrapped(self):
        from ai.keys import unwrap
        w = VECTORS["localWrap"]
        key = unwrap({"wrapped_by": "local:v1", "wrapped_key": w["wrapped"]}, w["masterKeyBase64"], w["userId"])
        self.assertEqual(key.hex(), VECTORS["dataKeyHex"])
        with self.assertRaises(Exception):
            unwrap({"wrapped_by": "local:v1", "wrapped_key": w["wrapped"]}, w["masterKeyBase64"], "someone-else")

    def test_unwraps_a_team_key_the_typescript_side_wrapped(self):
        from ai.keys import unwrap_local, unwrap_team
        w = VECTORS["teamWrap"]
        row = {"wrapped_by": "local:v1", "wrapped_key": w["wrapped"]}
        self.assertEqual(unwrap_team(row, w["masterKeyBase64"], w["workspaceId"]).hex(), VECTORS["teamDataKeyHex"])
        with self.assertRaises(Exception):
            unwrap_team(row, w["masterKeyBase64"], "another-workspace")
        with self.assertRaises(Exception):  # a team key is not a user's, even under the same ID
            unwrap_local(w["masterKeyBase64"], w["wrapped"], w["workspaceId"])
        with self.assertRaises(ValueError):
            unwrap_team({"wrapped_by": "kms:v1", "wrapped_key": w["wrapped"]}, w["masterKeyBase64"], w["workspaceId"])

    def test_the_saved_user_key_still_opens(self):
        from ai.keys import unwrap_local
        w = VECTORS["localWrap"]
        self.assertEqual(unwrap_local(w["masterKeyBase64"], w["wrapped"], w["userId"], "user").hex(), VECTORS["dataKeyHex"])


RING = json.loads((Path(__file__).resolve().parents[3] / "packages" / "crypto" / "keyring-vectors.json").read_text())


class RotatedKeys(unittest.TestCase):
    """A rotated user's keyring against packages/crypto/keyring-vectors.json, so both languages read a rotation alike."""

    def test_the_index_key_is_the_one_the_old_data_key_made(self):
        from ai.crypto import derive_index_key
        self.assertEqual(derive_index_key(bytes.fromhex(RING["previousKeyHex"])).hex(), RING["indexKeyHex"])

    def test_the_keyring_opens_both_seals_with_the_new_and_keeps_the_old_index_tokens(self):
        from ai.crypto import address_index, derive_user_keyring
        previous, current = bytes.fromhex(RING["previousKeyHex"]), bytes.fromhex(RING["currentKeyHex"])
        ring = derive_user_keyring(current, [previous], bytes.fromhex(RING["indexKeyHex"]))
        self.assertEqual(decrypt_field(ring, RING["field"], RING["sealedUnderPrevious"]), RING["plaintext"])
        self.assertEqual(decrypt_field(ring, RING["field"], RING["sealedUnderCurrent"]), RING["plaintext"])
        self.assertEqual(decrypt_any(KeySet(user=ring), RING["field"], RING["sealedUnderPrevious"]), RING["plaintext"])
        self.assertEqual(address_index(ring, RING["address"]), RING["addressToken"])
        fresh = encrypt_field(ring, RING["field"], "new")
        self.assertEqual(decrypt_field(derive_user_keys(current), RING["field"], fresh), "new")
        with self.assertRaises(Exception):
            decrypt_field(derive_user_keys(previous), RING["field"], fresh)
        with self.assertRaises(Exception):
            decrypt_field(derive_user_keyring(current), RING["field"], RING["sealedUnderPrevious"])
        old_file = encrypt_bytes(derive_user_keys(previous), "attachment_data", b"abc")
        self.assertEqual(decrypt_bytes(ring, "attachment_data", old_file), b"abc")

    def test_unwraps_the_index_key_the_typescript_side_wrapped(self):
        from ai.keys import unwrap_local, unwrap_user_ring
        w = RING["indexWrap"]
        self.assertEqual(unwrap_local(w["masterKeyBase64"], w["wrapped"], w["userId"], "user_index").hex(), RING["indexKeyHex"])
        with self.assertRaises(Exception):  # an index key is never a data key of the user
            unwrap_local(w["masterKeyBase64"], w["wrapped"], w["userId"])
        from ai.keys import wrap_local
        row = {
            "wrapped_by": "local:v1", "wrapped_key": wrap_local(w["masterKeyBase64"], bytes.fromhex(RING["currentKeyHex"]), w["userId"]),
            "previous_wrapped_by": "local:v1", "previous_wrapped_key": wrap_local(w["masterKeyBase64"], bytes.fromhex(RING["previousKeyHex"]), w["userId"]),
            "next_wrapped_key": None, "next_wrapped_by": None,
            "index_wrapped_by": "local:v1", "index_wrapped_key": w["wrapped"],
        }
        current, older, index_key = unwrap_user_ring(row, w["masterKeyBase64"], w["userId"])
        self.assertEqual((current.hex(), [k.hex() for k in older], index_key.hex()), (RING["currentKeyHex"], [RING["previousKeyHex"]], RING["indexKeyHex"]))

    def test_a_local_key_without_the_wrapping_key_names_the_cause(self):
        from ai.keys import LegacyKeyMissing, unwrap
        with self.assertRaises(LegacyKeyMissing):
            unwrap({"wrapped_by": "local:v1", "wrapped_key": VECTORS["localWrap"]["wrapped"]}, "", VECTORS["localWrap"]["userId"])
