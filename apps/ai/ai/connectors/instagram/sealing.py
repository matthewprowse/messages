"""Encryption the connector shares with the sync worker and the web app.

Sign-ins and sessions are sealed under ENCRYPTION_KEY, "v1:" + base64(iv 12 | GCM tag 16 | ciphertext), the
format of apps/worker/src/crypto.ts and apps/web/lib/server/accounts.ts. Message text and addresses are
sealed with the user's own keys, through the AI worker's Vault, and indexed with their blind-index key.
A user connecting Instagram before any other account has no data key yet, so one is made here the way the
sync worker makes it (packages/crypto/src/wrap.ts, local:v1)."""

from __future__ import annotations

import base64
import json
import os
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from ...crypto import UserKeys, address_index, blind_index, chat_key, encrypt_field
from ...fields import ADDRESS
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
    row = {"user_id": user_id, "wrapped_key": wrap_local(master_key_b64, os.urandom(32), user_id), "wrapped_by": "local:v1"}
    db.insert_new("user_keys", row, "user_id")


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
