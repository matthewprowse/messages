"""Unwrapping users' data keys, the same way as packages/crypto/src/wrap.ts.

user_keys holds each user's data key encrypted by a key-wrapping key; wrapped_by names which. "local:v1" is
AES-256-GCM under KEY_WRAPPING_KEY (32 bytes, base64) with "user_keys:<user id>" as additional data. The AI
worker only reads keys: the sync worker creates them when a user's first message arrives."""

from __future__ import annotations

import base64

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def unwrap_local(master_key_b64: str, wrapped: str, user_id: str) -> bytes:
    master = base64.b64decode(master_key_b64)
    if len(master) != 32:
        raise ValueError("KEY_WRAPPING_KEY must be 32 bytes, base64 encoded.")
    raw = base64.b64decode(wrapped)
    return AESGCM(master).decrypt(raw[:12], raw[12:], f"user_keys:{user_id}".encode("utf-8"))


def unwrap(row: dict, master_key_b64: str, user_id: str) -> bytes:
    """A user's data key from their user_keys row. Raises for a wrapper this worker is not set up for."""
    if row.get("wrapped_by") == "local:v1":
        return unwrap_local(master_key_b64, row["wrapped_key"], user_id)
    raise ValueError(f"No key wrapper for {row.get('wrapped_by')}.")
