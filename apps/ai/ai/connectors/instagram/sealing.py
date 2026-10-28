"""Encryption the connector shares with the sync worker and the web app.

Stored sign-ins and sessions are sealed "v2:" under a key derived from the account owner's data key, the account's ID
as additional data (AccountSealer below; ai/crypto.py seal_credential, apps/worker/src/crypto.ts). Older "v1:" values
(the static ENCRYPTION_KEY, "v1:" + base64(iv 12 | GCM tag 16 | ciphertext)) are still read until
`pnpm credentials:reseal` has moved them. seal_json and open_json (v1) remain for short-lived handoffs the web app seals
with the static key, such as a sign-in code. Message text and addresses are sealed with the user's own keys, through the
AI worker's Vault, and indexed with their blind-index key. A user connecting Instagram before any other account has no
data key yet, so one is made here the way the sync worker makes it (packages/crypto/src/wrap.ts: kms:v1 when
KMS_KEY_NAME is set, else local:v1)."""

from __future__ import annotations

import base64
import json
import os
from typing import Any, Callable

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from ...crypto import CREDENTIAL_PREFIX, UserKeys, address_index, blind_index, chat_key, encrypt_field, open_credential, seal_credential
from ...fields import ADDRESS
from ...keys import wrap_new
from ...vault import Vault


def _key(raw_b64: str) -> bytes:
    key = base64.b64decode(raw_b64 or "")
    if len(key) != 32:
        raise ValueError("ENCRYPTION_KEY must be 32 bytes, base64 encoded.")
    return key


def seal_json(value: Any, key_b64: str) -> str:
    iv = os.urandom(12)
    sealed = AESGCM(_key(key_b64)).encrypt(iv, json.dumps(value).encode("utf-8"), None)
    # AESGCM puts the tag after the ciphertext; the v1 format has it first.
    return "v1:" + base64.b64encode(iv + sealed[-16:] + sealed[:-16]).decode("ascii")


def open_json(payload: str, key_b64: str) -> Any:
    if not payload.startswith("v1:"):
        raise ValueError("Unknown ciphertext format.")
    raw = base64.b64decode(payload[3:])
    iv, tag, body = raw[:12], raw[12:28], raw[28:]
    return json.loads(AESGCM(_key(key_b64)).decrypt(iv, body + tag, None).decode("utf-8"))


def wrap_local(master_key_b64: str, data_key: bytes, user_id: str) -> str:
    """A data key wrapped as local:v1, as packages/crypto/src/wrap.ts does (ai/keys.py unwraps it)."""
    iv = os.urandom(12)
    sealed = AESGCM(_key(master_key_b64)).encrypt(iv, data_key, f"user_keys:{user_id}".encode("utf-8"))
    return base64.b64encode(iv + sealed).decode("ascii")


def ensure_user_key(db: Any, master_key_b64: str, user_id: str) -> None:
    """Makes the user's data key if they have none. Two processes racing keep the first one written."""
    if db.first("user_keys", {"select": "user_id", "user_id": f"eq.{user_id}"}):
        return
    wrapped, by = wrap_new(master_key_b64, os.urandom(32), user_id)  # kms:v1 when KMS_KEY_NAME is set, else local:v1
    db.insert_new("user_keys", {"user_id": user_id, "wrapped_key": wrapped, "wrapped_by": by}, "user_id")


class AccountSealer:
    """Seals and opens one connector account's stored sign-in and session under its owner's key ("v2:"), and
    reads older "v1:" values with the static key. The owner is looked up from the account and remembered."""

    def __init__(self, db: Any, vault: Vault, legacy_key_b64: str, ensure: Callable[[str], None] | None = None):
        self.db = db
        self.vault = vault
        self.legacy_key_b64 = legacy_key_b64
        self.ensure = ensure  # makes the owner's data key if they have none (Instagram can be a user's first account)
        self._owners: dict[str, str] = {}

    def owner(self, account_id: str) -> str:
        if account_id not in self._owners:
            row = self.db.first("accounts", {"select": "user_id", "id": f"eq.{account_id}"})
            if not row:
                raise RuntimeError("unknown account")
            self._owners[account_id] = row["user_id"]
        return self._owners[account_id]

    def seal(self, account_id: str, value: Any) -> str:
        user = self.owner(account_id)
        if self.ensure:
            self.ensure(user)
        key = self.vault.credential_key_for(user)
        if key is None:
            raise RuntimeError("no user key")
        return seal_credential(key, account_id, json.dumps(value))

    def open(self, account_id: str, payload: str) -> Any:
        if payload.startswith(CREDENTIAL_PREFIX):
            key = self.vault.credential_key_for(self.owner(account_id))
            if key is None:
                raise RuntimeError("no user key")
            return json.loads(open_credential(key, account_id, payload))
        if not self.legacy_key_b64:
            raise ValueError("A v1 credential needs ENCRYPTION_KEY, which is not set.")
        return open_json(payload, self.legacy_key_b64)

    @staticmethod
    def sealed(payload: str | None) -> bool:
        """Whether a stored value is one this can open (v1 or v2); empty and unknown formats are not."""
        return bool(payload) and (payload.startswith("v1:") or payload.startswith(CREDENTIAL_PREFIX))  # type: ignore[union-attr]


class UserSealer:
    """mapping.Sealer for one user: text through the Vault (ENCRYPT_CONTENT), addresses when
    ENCRYPT_ADDRESSES is on, and blind indexes always."""

    def __init__(self, vault: Vault, keys: UserKeys, user_id: str, encrypt_addresses: bool):
        self.vault = vault
        self.keys = keys
        self.user_id = user_id
        self.encrypt_addresses = encrypt_addresses

    def seal(self, field: str, value: str | None) -> str | None:
        return self.vault.seal(self.user_id, field, value)

    def address(self, value: str | None) -> str | None:
        if value is None or not self.encrypt_addresses:
            return value
        return encrypt_field(self.keys, ADDRESS, value)

    def address_index(self, value: str) -> str:
        return address_index(self.keys, value)

    def chat_index(self, value: str) -> str:
        return blind_index(self.keys, chat_key(value))
