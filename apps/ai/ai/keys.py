"""Unwrapping users' data keys, the same way as packages/crypto/src/wrap.ts.

user_keys holds each user's data key encrypted by a wrapper; wrapped_by names which.
  "local:v1"  AES-256-GCM under KEY_WRAPPING_KEY (32 bytes, base64) with "user_keys:<user id>" as additional data.
  "kms:v1"    Google Cloud KMS Encrypt/Decrypt (KMS_KEY_NAME) over the REST API with the same additional data. The
              bearer token comes from a service account key (GOOGLE_APPLICATION_CREDENTIALS_JSON, or the file named
              by GOOGLE_APPLICATION_CREDENTIALS), KMS_ACCESS_TOKEN, or the metadata server, in that order, so no SDK
              is needed. Unwrapped keys are cached in memory for about 10 minutes and never written or logged.
A workspace's key (team_keys, one row per version) is wrapped the same way with "team_keys:<workspace id>". The AI
worker only reads keys: the sync worker creates them when a user's first message arrives, or a workspace's key is
first used. The Instagram connector may make a user's key (wrap_new), with kms:v1 when KMS_KEY_NAME is set.

During a rotation of a user's key (apps/worker/src/rekey) their user_keys row also names the next or previous key (both
open, neither seals) and the index key their blind indexes are made with ("user_index_keys:<user id>"):
unwrap_user_ring reads them all. local:v1 is being retired: without KEY_WRAPPING_KEY a row it made raises
LegacyKeyMissing, whose name is the code the logs show."""

from __future__ import annotations

import base64
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .tls import CONTEXT

KEY_CACHE_S = 10 * 60


class LegacyKeyMissing(ValueError):
    """A key wrapped by local:v1 while KEY_WRAPPING_KEY is not set: run `pnpm --filter worker rewrap-keys` (or set it back)."""


def _aad(scope: str, owner_id: str) -> bytes:
    return f"{scope}_keys:{owner_id}".encode("utf-8")


def unwrap_local(master_key_b64: str, wrapped: str, owner_id: str, scope: str = "user") -> bytes:
    """`owner_id` is the user's ID, or the workspace's when `scope` is "team"."""
    master = base64.b64decode(master_key_b64)
    if len(master) != 32:
        raise ValueError("KEY_WRAPPING_KEY must be 32 bytes, base64 encoded.")
    raw = base64.b64decode(wrapped)
    return AESGCM(master).decrypt(raw[:12], raw[12:], _aad(scope, owner_id))


def wrap_local(master_key_b64: str, data_key: bytes, owner_id: str, scope: str = "user") -> str:
    master = base64.b64decode(master_key_b64)
    if len(master) != 32:
        raise ValueError("KEY_WRAPPING_KEY must be 32 bytes, base64 encoded.")
    iv = os.urandom(12)
    return base64.b64encode(iv + AESGCM(master).encrypt(iv, data_key, _aad(scope, owner_id))).decode("ascii")


# --- Google Cloud KMS -------------------------------------------------------------------------------------


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def google_access_token(env: dict[str, str] | None = None) -> Callable[[], str]:
    """A function that returns a bearer token for Google APIs, cached until a minute before it expires. See the
    module docstring for where the token comes from. Its forget() drops the cached token, for one Google refused."""
    environ = env if env is not None else dict(os.environ)
    state: dict[str, Any] = {"token": None, "until": 0.0}
    lock = threading.Lock()

    def request(url: str, data: bytes | None = None, headers: dict[str, str] | None = None) -> dict[str, Any]:
        req = urllib.request.Request(url, data=data, headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=10, context=CONTEXT) as res:
                return json.loads(res.read())
        except urllib.error.HTTPError as err:
            raise RuntimeError(f"Google token request failed ({err.code}).") from None

    def fetch() -> tuple[str, float]:
        raw = environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON")
        path = environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if not raw and path:
            with open(path, "r", encoding="utf-8") as f:
                raw = f.read()
        if raw:
            account = json.loads(raw)
            aud = account.get("token_uri") or "https://oauth2.googleapis.com/token"
            iat = int(time.time())
            claims = {"iss": account["client_email"], "scope": "https://www.googleapis.com/auth/cloud-platform", "aud": aud, "iat": iat, "exp": iat + 3600}
            unsigned = f"{_b64url(json.dumps({'alg': 'RS256', 'typ': 'JWT'}).encode())}.{_b64url(json.dumps(claims).encode())}"
            key = serialization.load_pem_private_key(account["private_key"].encode("utf-8"), password=None)
            signature = key.sign(unsigned.encode("ascii"), padding.PKCS1v15(), hashes.SHA256())  # type: ignore[call-arg]
            body = urllib.parse.urlencode({"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": f"{unsigned}.{_b64url(signature)}"}).encode()
            out = request(aud, body, {"Content-Type": "application/x-www-form-urlencoded"})
            return out["access_token"], float(out.get("expires_in", 3600))
        if environ.get("KMS_ACCESS_TOKEN"):
            return environ["KMS_ACCESS_TOKEN"], 300.0
        host = environ.get("GCE_METADATA_HOST") or "metadata.google.internal"
        out = request(f"http://{host}/computeMetadata/v1/instance/service-accounts/default/token", None, {"Metadata-Flavor": "Google"})
        return out["access_token"], float(out.get("expires_in", 300))

    def token() -> str:
        with lock:
            # Wall clock, not monotonic: the token expires in real time, and on a Mac the monotonic clock stops while
            # it sleeps, so after a sleep an expired token was kept and every unwrap failed for up to an hour.
            if state["token"] and state["until"] > time.time():
                return state["token"]
            value, ttl = fetch()
            state["token"], state["until"] = value, time.time() + max(0.0, ttl - 60)
            return value

    def forget() -> None:
        with lock:
            state["token"] = None

    token.forget = forget  # type: ignore[attr-defined]
    return token


class Kms:
    """Cloud KMS Encrypt and Decrypt for data keys (wrapped_by "kms:v1")."""

    id = "kms:v1"

    def __init__(self, key_name: str, token: Callable[[], str] | None = None, endpoint: str = "https://cloudkms.googleapis.com", now: Callable[[], float] = time.monotonic):
        self.key_name = key_name
        self.token = token or google_access_token()
        self.endpoint = endpoint.rstrip("/")
        self.now = now
        self._cache: dict[str, tuple[float, bytes]] = {}
        self._lock = threading.Lock()

    def _call(self, op: str, body: dict[str, str], retry: bool = True) -> dict[str, str]:
        req = urllib.request.Request(
            f"{self.endpoint}/v1/{self.key_name}:{op}",
            data=json.dumps(body).encode("utf-8"),
            headers={"Authorization": f"Bearer {self.token()}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=10, context=CONTEXT) as res:
                return json.loads(res.read())
        except urllib.error.HTTPError as err:
            forget = getattr(self.token, "forget", None)
            if err.code == 401 and retry and forget:
                forget()  # the cached token expired or was revoked early: fetch a new one and try once more
                return self._call(op, body, retry=False)
            # Only the status is reported: a response body could echo parts of a request.
            raise RuntimeError(f"KMS {op} failed ({err.code}).") from None

    def wrap(self, data_key: bytes, owner_id: str, scope: str = "user") -> str:
        out = self._call("encrypt", {"plaintext": base64.b64encode(data_key).decode("ascii"), "additionalAuthenticatedData": base64.b64encode(_aad(scope, owner_id)).decode("ascii")})
        if not out.get("ciphertext"):
            raise RuntimeError("KMS encrypt returned nothing.")
        return out["ciphertext"]

    def unwrap(self, wrapped: str, owner_id: str, scope: str = "user") -> bytes:
        cache_id = f"{scope}:{owner_id}:{wrapped}"
        with self._lock:
            hit = self._cache.get(cache_id)
            if hit and hit[0] > self.now():
                return hit[1]
        out = self._call("decrypt", {"ciphertext": wrapped, "additionalAuthenticatedData": base64.b64encode(_aad(scope, owner_id)).decode("ascii")})
        key = base64.b64decode(out.get("plaintext", ""))
        if len(key) != 32:
            raise RuntimeError("KMS returned a key of the wrong size.")
        with self._lock:
            now = self.now()
            for k in [k for k, (until, _) in self._cache.items() if until <= now]:
                del self._cache[k]
            self._cache[cache_id] = (now + KEY_CACHE_S, key)
        return key


_kms: Kms | None = None
_kms_set = False
_kms_lock = threading.Lock()


def kms_from_env() -> Kms | None:
    """The process's KMS client, made once from KMS_KEY_NAME. None when it is not set."""
    global _kms, _kms_set
    with _kms_lock:
        if not _kms_set:
            name = os.environ.get("KMS_KEY_NAME", "").strip()
            _kms = Kms(name) if name else None
            _kms_set = True
        return _kms


def set_kms(kms: Kms | None) -> None:
    """Replaces the process's KMS client (tests)."""
    global _kms, _kms_set
    with _kms_lock:
        _kms, _kms_set = kms, True


def _unwrap_row(row: dict, master_key_b64: str, owner_id: str, scope: str, kms: Kms | None) -> bytes:
    by = row.get("wrapped_by")
    if by == "local:v1":
        if not master_key_b64:
            raise LegacyKeyMissing("A local:v1 key needs KEY_WRAPPING_KEY, which is not set.")
        return unwrap_local(master_key_b64, row["wrapped_key"], owner_id, scope)
    if by == "kms:v1":
        client = kms or kms_from_env()
        if client is None:
            raise ValueError("No key wrapper for kms:v1: KMS_KEY_NAME is not set.")
        return client.unwrap(row["wrapped_key"], owner_id, scope)
    raise ValueError(f"No key wrapper for {by}.")


def unwrap(row: dict, master_key_b64: str, user_id: str, kms: Kms | None = None) -> bytes:
    """A user's data key from their user_keys row. Raises for a wrapper this worker is not set up for."""
    return _unwrap_row(row, master_key_b64, user_id, "user", kms)


def unwrap_user_ring(row: dict, master_key_b64: str, user_id: str, kms: Kms | None = None) -> tuple[bytes, list[bytes], bytes | None]:
    """A user's keyring from their whole user_keys row, as (current, older, index key or None), like userKeyringFor in
    packages/crypto/src/wrap.ts. Every key the row names must unwrap, or this raises: a value under a key this worker
    cannot open would otherwise read as empty."""
    current = unwrap(row, master_key_b64, user_id, kms)
    older = [
        _unwrap_row({"wrapped_key": row[f"{slot}_wrapped_key"], "wrapped_by": row.get(f"{slot}_wrapped_by")}, master_key_b64, user_id, "user", kms)
        for slot in ("next", "previous")
        if row.get(f"{slot}_wrapped_key") and row.get(f"{slot}_wrapped_by")
    ]
    index_key = None
    if row.get("index_wrapped_key") and row.get("index_wrapped_by"):
        index_key = _unwrap_row({"wrapped_key": row["index_wrapped_key"], "wrapped_by": row["index_wrapped_by"]}, master_key_b64, user_id, "user_index", kms)
    return current, older, index_key


def unwrap_team(row: dict, master_key_b64: str, workspace_id: str, kms: Kms | None = None) -> bytes:
    """One version of a workspace's data key from its team_keys row. Raises for a wrapper this worker is not set up for."""
    return _unwrap_row(row, master_key_b64, workspace_id, "team", kms)


def unwrap_team_ring(rows: list[dict], master_key_b64: str, workspace_id: str, kms: Kms | None = None) -> tuple[list[tuple[int, bytes]], bytes, bool]:
    """Every readable version of a workspace's key, newest first as (version, key), the index root, and whether that
    root is the index key itself. The team's blind indexes always use one key (see TeamKeyring in
    packages/crypto/src/wrap.ts): the index key stored apart on the first version's row (index_wrapped_key, used as it
    is: derived True) or, until the sync worker has stored it, the first version's data key, from which the caller
    derives it (derived False). A retired version (retired_at set) is left out of the list, and the first is opened
    only when it is needed as the root. A version this worker cannot open is skipped, except the newest and the root,
    which raise."""
    ordered = sorted(rows, key=lambda r: int(r.get("key_version") or 1), reverse=True)
    if not ordered:
        raise ValueError("No team key.")
    newest, first = ordered[0], ordered[-1]
    indexed = bool(first.get("index_wrapped_key")) and bool(first.get("index_wrapped_by"))
    keys: list[tuple[int, bytes]] = []
    root: bytes | None = None
    for row in ordered:
        if row.get("retired_at") and (row is not first or indexed):
            continue
        try:
            key = unwrap_team(row, master_key_b64, workspace_id, kms)
        except Exception:
            if row is newest or (row is first and not indexed):
                raise
            continue
        if not row.get("retired_at"):
            keys.append((int(row.get("key_version") or 1), key))
        if row is first and not indexed:
            root = key
    if indexed:
        root = _unwrap_row({"wrapped_key": first["index_wrapped_key"], "wrapped_by": first["index_wrapped_by"]}, master_key_b64, workspace_id, "team_index", kms)
    if not keys or root is None:
        raise ValueError("Could not open the team key.")
    return keys, root, indexed


def wrap_new(master_key_b64: str, data_key: bytes, owner_id: str, scope: str = "user", kms: Kms | None = None) -> tuple[str, str]:
    """A data key wrapped for storing, as (wrapped_key, wrapped_by): by KMS when KMS_KEY_NAME is set, else locally."""
    client = kms or kms_from_env()
    if client is not None:
        return client.wrap(data_key, owner_id, scope), client.id
    if not master_key_b64:
        raise ValueError("Set KMS_KEY_NAME (or, until it is retired, KEY_WRAPPING_KEY) to make keys.")
    return wrap_local(master_key_b64, data_key, owner_id, scope), "local:v1"
