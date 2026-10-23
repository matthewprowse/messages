"""Field encryption, the same format as packages/crypto/src/index.ts (the browser and the Node worker).

A value is stored as "e1:" + base64(nonce 12 bytes | ciphertext | GCM tag 16 bytes), AES-256-GCM, with the
field it belongs to ("messages.body_text") as additional data. A user's encryption and blind-index keys are
derived from their 32-byte data key with HKDF-SHA256. packages/crypto/vectors.json pins the format for both."""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
from dataclasses import dataclass

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

PREFIX = "e1:"
ENC_INFO = b"messages/field-encryption/v1"
INDEX_INFO = b"messages/blind-index/v1"
NONCE_BYTES = 12


@dataclass(frozen=True)
class UserKeys:
    enc: bytes
    index: bytes


def _hkdf(data_key: bytes, info: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=bytes(32), info=info).derive(data_key)


def derive_user_keys(data_key: bytes) -> UserKeys:
    if len(data_key) != 32:
        raise ValueError("A data key is 32 bytes.")
    return UserKeys(enc=_hkdf(data_key, ENC_INFO), index=_hkdf(data_key, INDEX_INFO))


def is_ciphertext(value: object) -> bool:
    return isinstance(value, str) and value.startswith(PREFIX)


def encrypt_field(keys: UserKeys, field: str, plaintext: str, nonce: bytes | None = None) -> str:
    iv = nonce if nonce is not None else os.urandom(NONCE_BYTES)
    if len(iv) != NONCE_BYTES:
        raise ValueError("A nonce is 12 bytes.")
    sealed = AESGCM(keys.enc).encrypt(iv, plaintext.encode("utf-8"), field.encode("utf-8"))
    return PREFIX + base64.b64encode(iv + sealed).decode("ascii")


def decrypt_field(keys: UserKeys, field: str, payload: str) -> str:
    if not is_ciphertext(payload):
        raise ValueError("Not an encrypted value.")
    raw = base64.b64decode(payload[len(PREFIX):])
    if len(raw) < NONCE_BYTES + 16:
        raise ValueError("Encrypted value is too short.")
    return AESGCM(keys.enc).decrypt(raw[:NONCE_BYTES], raw[NONCE_BYTES:], field.encode("utf-8")).decode("utf-8")


def encrypt_optional(keys: UserKeys, field: str, plaintext: str | None) -> str | None:
    return None if plaintext is None else encrypt_field(keys, field, plaintext)


def decrypt_optional(keys: UserKeys, field: str, payload: str | None) -> str | None:
    return None if payload is None else decrypt_field(keys, field, payload)


def blind_index(keys: UserKeys, value: str) -> str:
    mac = hmac.new(keys.index, value.strip().encode("utf-8"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).decode("ascii").rstrip("=")


# What a blind index is taken of, for addresses: the same rules as packages/crypto/src/addresses.ts, checked
# by the shared vectors. Each kind is prefixed so an email, a number and a domain never share a token.
def address_key(value: str) -> str:
    """Who someone is: an email address, a phone number in E.164, or a WhatsApp lid."""
    v = value.strip().lower()
    if re.fullmatch(r"[0-9]+@lid", v):
        return f"lid:{v}"
    if "@" in v:
        return f"email:{v}"
    digits = re.sub(r"[\s().-]", "", v)
    if re.fullmatch(r"\+?[0-9]{7,15}", digits):
        return f"phone:+{digits.lstrip('+')}"
    return f"other:{v}"


def chat_key(value: str) -> str:
    return f"chat:{value.strip().lower()}"


def domain_key(value: str) -> str:
    v = value.strip().lower()
    return f"domain:{v.removeprefix('@').removesuffix('.')}"


def address_index(keys: UserKeys, value: str) -> str:
    return blind_index(keys, address_key(value))


def domain_index(keys: UserKeys, value: str) -> str:
    return blind_index(keys, domain_key(value))
