"""kms:v1 (Google Cloud KMS over REST, against a fake server), versioned team keys, and per-user connector credentials
(the "v2:" format, pinned by packages/crypto/credential-vectors.json for both languages)."""

import base64
import json
import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from ai import keys as keys_module
from ai.crypto import derive_credential_key, open_credential, seal_credential
from ai.keys import Kms, google_access_token, set_kms, unwrap, unwrap_team, unwrap_team_ring, wrap_new

ROOT = Path(__file__).resolve().parents[3] / "packages" / "crypto"
CRED = json.loads((ROOT / "credential-vectors.json").read_text())
KEY_NAME = "projects/messages-keys/locations/africa-south1/keyRings/messages/cryptoKeys/user-data-keys"


class FakeKms:
    """A Cloud KMS stand-in: AES-GCM under a key of its own, additional data checked, calls recorded."""

    def __init__(self):
        self.master = os.urandom(32)
        self.calls: list[tuple[str, str | None]] = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                outer.calls.append((self.path, self.headers.get("Authorization")))
                aad = base64.b64decode(body.get("additionalAuthenticatedData", ""))
                try:
                    if self.path.endswith(":encrypt"):
                        iv = os.urandom(12)
                        out = {"ciphertext": base64.b64encode(iv + AESGCM(outer.master).encrypt(iv, base64.b64decode(body["plaintext"]), aad)).decode()}
                    elif self.path.endswith(":decrypt"):
                        raw = base64.b64decode(body["ciphertext"])
                        out = {"plaintext": base64.b64encode(AESGCM(outer.master).decrypt(raw[:12], raw[12:], aad)).decode()}
                    else:
                        self.send_response(404)
                        self.end_headers()
                        return
                except Exception:
                    self.send_response(400)
                    self.end_headers()
                    self.wfile.write(b'{"error":{"message":"secret-detail"}}')
                    return
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps(out).encode())

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class KmsTests(unittest.TestCase):
    def setUp(self):
        self.fake = FakeKms()
        self.addCleanup(self.fake.close)
        self.addCleanup(set_kms, None)
        self.now = [1000.0]
        self.kms = Kms(KEY_NAME, token=lambda: "tok-1", endpoint=self.fake.url, now=lambda: self.now[0])

    def test_round_trips_binds_to_owner_and_scope_and_sends_the_token(self):
        key = os.urandom(32)
        wrapped = self.kms.wrap(key, "user-1")
        self.assertEqual(self.kms.unwrap(wrapped, "user-1"), key)
        self.assertEqual(self.fake.calls[0], (f"/v1/{KEY_NAME}:encrypt", "Bearer tok-1"))
        with self.assertRaises(RuntimeError) as err:
            self.kms.unwrap(wrapped, "user-2")
        self.assertIn("400", str(err.exception))
        self.assertNotIn("secret-detail", str(err.exception))
        with self.assertRaises(RuntimeError):
            self.kms.unwrap(wrapped, "user-1", "team")
        team = self.kms.wrap(key, "w-1", "team")
        self.assertEqual(self.kms.unwrap(team, "w-1", "team"), key)
        with self.assertRaises(RuntimeError):
            self.kms.unwrap(team, "w-1")

    def test_caches_unwrapped_keys_for_ten_minutes(self):
        wrapped = self.kms.wrap(os.urandom(32), "u")
        decrypts = lambda: sum(1 for p, _ in self.fake.calls if p.endswith(":decrypt"))
        self.kms.unwrap(wrapped, "u")
        self.kms.unwrap(wrapped, "u")
        self.assertEqual(decrypts(), 1)
        self.now[0] += 9 * 60
        self.kms.unwrap(wrapped, "u")
        self.assertEqual(decrypts(), 1)
        self.now[0] += 2 * 60
        self.kms.unwrap(wrapped, "u")
        self.assertEqual(decrypts(), 2)

    def test_unwrap_picks_the_wrapper_by_wrapped_by(self):
        key = os.urandom(32)
        row = {"wrapped_by": "kms:v1", "wrapped_key": self.kms.wrap(key, "u1")}
        self.assertEqual(unwrap(row, "", "u1", self.kms), key)
        set_kms(None)  # KMS not set up in this process: refused, not guessed at
        with self.assertRaises(ValueError):
            unwrap(row, "", "u1")
        set_kms(self.kms)
        self.assertEqual(unwrap(row, "", "u1"), key)

    def test_wrap_new_uses_kms_when_set_and_local_otherwise(self):
        master = base64.b64encode(os.urandom(32)).decode()
        key = os.urandom(32)
        wrapped, by = wrap_new(master, key, "u1")
        self.assertEqual(by, "local:v1")
        self.assertEqual(unwrap({"wrapped_by": by, "wrapped_key": wrapped}, master, "u1"), key)
        set_kms(self.kms)
        wrapped, by = wrap_new(master, key, "u1")
        self.assertEqual(by, "kms:v1")
        self.assertEqual(unwrap({"wrapped_by": by, "wrapped_key": wrapped}, master, "u1"), key)

    def test_token_comes_from_the_metadata_server_and_is_cached(self):
        hits = []

        class Meta(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                hits.append(self.headers.get("Metadata-Flavor"))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"access_token":"meta-token","expires_in":3599}')

        server = HTTPServer(("127.0.0.1", 0), Meta)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        token = google_access_token({"GCE_METADATA_HOST": f"127.0.0.1:{server.server_port}"})
        self.assertEqual(token(), "meta-token")
        self.assertEqual(token(), "meta-token")
        self.assertEqual(hits, ["Google"])


    def test_token_for_a_service_account_key_is_a_signed_jwt(self):
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding, rsa

        private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = private.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
        seen = {}

        class Token(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                from urllib.parse import parse_qs
                seen.update(parse_qs(self.rfile.read(int(self.headers["Content-Length"])).decode()))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"access_token":"sa-token","expires_in":3600}')

        server = HTTPServer(("127.0.0.1", 0), Token)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        account = json.dumps({"client_email": "kms@messages-keys.iam.gserviceaccount.com", "private_key": pem, "token_uri": f"http://127.0.0.1:{server.server_port}/token"})
        self.assertEqual(google_access_token({"GOOGLE_APPLICATION_CREDENTIALS_JSON": account})(), "sa-token")
        header, claims, signature = seen["assertion"][0].split(".")
        pad = lambda t: t + "=" * (-len(t) % 4)
        self.assertEqual(json.loads(base64.urlsafe_b64decode(pad(claims)))["iss"], "kms@messages-keys.iam.gserviceaccount.com")
        private.public_key().verify(base64.urlsafe_b64decode(pad(signature)), f"{header}.{claims}".encode(), padding.PKCS1v15(), hashes.SHA256())


class TeamRingTests(unittest.TestCase):
    def test_reads_versions_newest_first_and_the_first_as_index_root(self):
        master = base64.b64encode(os.urandom(32)).decode()
        k1, k2, k3 = os.urandom(32), os.urandom(32), os.urandom(32)
        row = lambda v, k, retired=None: {"key_version": v, "wrapped_key": keys_module.wrap_local(master, k, "w1", "team"), "wrapped_by": "local:v1", "retired_at": retired}
        versions, root = unwrap_team_ring([row(2, k2, "x"), row(1, k1, "x"), row(3, k3)], master, "w1")
        self.assertEqual([v for v, _ in versions], [3])  # 1 and 2 are retired
        self.assertEqual(root, k1)  # but the first stays as the index root
        versions, root = unwrap_team_ring([row(1, k1), row(2, k2)], master, "w1")
        self.assertEqual([(v, k) for v, k in versions], [(2, k2), (1, k1)])
        self.assertEqual(root, k1)
        with self.assertRaises(Exception):  # a row moved to another workspace does not open
            unwrap_team_ring([row(1, k1)], master, "w2")
        self.assertEqual(unwrap_team(row(1, k1), master, "w1"), k1)


class CredentialTests(unittest.TestCase):
    def test_matches_the_typescript_vector_byte_for_byte(self):
        key = derive_credential_key(bytes.fromhex(CRED["dataKeyHex"]))
        self.assertEqual(key.hex(), CRED["credentialKeyHex"])
        self.assertEqual(open_credential(key, CRED["accountId"], CRED["sealed"]), CRED["plaintext"])
        self.assertEqual(seal_credential(key, CRED["accountId"], CRED["plaintext"], bytes.fromhex(CRED["ivHex"])), CRED["sealed"])

    def test_only_opens_for_its_account_and_user(self):
        key = derive_credential_key(bytes.fromhex(CRED["dataKeyHex"]))
        with self.assertRaises(Exception):
            open_credential(key, "another-account", CRED["sealed"])
        with self.assertRaises(Exception):
            open_credential(derive_credential_key(bytes(32)), CRED["accountId"], CRED["sealed"])
        sealed = seal_credential(key, "acc", "secret")
        self.assertNotEqual(sealed, seal_credential(key, "acc", "secret"))
        self.assertEqual(open_credential(key, "acc", sealed), "secret")
