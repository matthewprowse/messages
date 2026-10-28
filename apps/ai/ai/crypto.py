"""Field encryption, the same format as packages/crypto/src/index.ts (the browser and the Node worker).

A value is stored as "e1:" + base64(nonce 12 bytes | ciphertext | GCM tag 16 bytes), AES-256-GCM, with the
field it belongs to ("messages.body_text") as additional data. A user's encryption and blind-index keys are
derived from their 32-byte data key with HKDF-SHA256. packages/crypto/vectors.json pins the format for both.

A team (workspace) has a data key of its own. A value sealed with it is "t1:" plus the same layout and the same
field additional data, under keys derived with their own HKDF info strings, so a team key is never a user key.
Readers pick the key by the prefix: e1 is the user's, t1 the team's of the row's workspace."""

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
TEAM_PREFIX = "t1:"
ENC_INFO = b"messages/field-encryption/v1"
INDEX_INFO = b"messages/blind-index/v1"
TEAM_ENC_INFO = b"messages/team-field-encryption/v1"
TEAM_INDEX_INFO = b"messages/team-blind-index/v1"
NONCE_BYTES = 12


@dataclass(frozen=True)
class UserKeys:
    enc: bytes
    index: bytes


@dataclass(frozen=True)
class TeamKeys:
    enc: bytes
    index: bytes


@dataclass(frozen=True)
class KeySet:
    """The keys a reader holds, whichever it has: the user's, and the team's when they are in a workspace."""

    user: UserKeys | None = None
    team: TeamKeys | None = None


def _hkdf(data_key: bytes, info: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=bytes(32), info=info).derive(data_key)


def derive_user_keys(data_key: bytes) -> UserKeys:
    if len(data_key) != 32:
        raise ValueError("A data key is 32 bytes.")
    return UserKeys(enc=_hkdf(data_key, ENC_INFO), index=_hkdf(data_key, INDEX_INFO))


def derive_team_keys(data_key: bytes) -> TeamKeys:
    if len(data_key) != 32:
        raise ValueError("A data key is 32 bytes.")
    return TeamKeys(enc=_hkdf(data_key, TEAM_ENC_INFO), index=_hkdf(data_key, TEAM_INDEX_INFO))


def is_ciphertext(value: object) -> bool:
    """Whether a stored value is sealed, with a user's key (e1:) or a team's (t1:)."""
    return isinstance(value, str) and (value.startswith(PREFIX) or value.startswith(TEAM_PREFIX))


def is_team_ciphertext(value: object) -> bool:
    return isinstance(value, str) and value.startswith(TEAM_PREFIX)


def _seal(enc: bytes, prefix: str, field: str, plaintext: str, nonce: bytes | None) -> str:
    iv = nonce if nonce is not None else os.urandom(NONCE_BYTES)
    if len(iv) != NONCE_BYTES:
        raise ValueError("A nonce is 12 bytes.")
    sealed = AESGCM(enc).encrypt(iv, plaintext.encode("utf-8"), field.encode("utf-8"))
    return prefix + base64.b64encode(iv + sealed).decode("ascii")


def _unseal(enc: bytes, prefix: str, field: str, payload: str) -> str:
    raw = base64.b64decode(payload[len(prefix):])
    if len(raw) < NONCE_BYTES + 16:
        raise ValueError("Encrypted value is too short.")
    return AESGCM(enc).decrypt(raw[:NONCE_BYTES], raw[NONCE_BYTES:], field.encode("utf-8")).decode("utf-8")


def encrypt_field(keys: UserKeys, field: str, plaintext: str, nonce: bytes | None = None) -> str:
    return _seal(keys.enc, PREFIX, field, plaintext, nonce)


def decrypt_field(keys: UserKeys, field: str, payload: str) -> str:
    if not isinstance(payload, str) or not payload.startswith(PREFIX):
        raise ValueError("Not an encrypted value.")
    return _unseal(keys.enc, PREFIX, field, payload)


def encrypt_team_field(keys: TeamKeys, field: str, plaintext: str, nonce: bytes | None = None) -> str:
    """encrypt_field with a team's key: the same layout and field additional data, marked "t1:"."""
    return _seal(keys.enc, TEAM_PREFIX, field, plaintext, nonce)


def decrypt_team_field(keys: TeamKeys, field: str, payload: str) -> str:
    if not is_team_ciphertext(payload):
        raise ValueError("Not a team encrypted value.")
    return _unseal(keys.enc, TEAM_PREFIX, field, payload)


def decrypt_any(keys: KeySet, field: str, payload: str) -> str:
    """Decrypts a field of either kind, choosing the key by its prefix: e1 with the user's keys, t1 with the
    team's. Raises a clear error when the key it needs is not held."""
    if is_team_ciphertext(payload):
        if keys.team is None:
            raise ValueError("A team value needs the team's keys.")
        return decrypt_team_field(keys.team, field, payload)
    if keys.user is None:
        raise ValueError("A user value needs the user's keys.")
    return decrypt_field(keys.user, field, payload)


# Sealed files (encryptBytes in index.ts): MAGIC, a 12-byte nonce, then ciphertext and its 16-byte tag, with
# the field as additional data. MAGIC is "e1b:" 00 FF "KN".
MAGIC = bytes([0x65, 0x31, 0x62, 0x3A, 0x00, 0xFF, 0x4B, 0x4E])


def is_sealed_bytes(data: bytes) -> bool:
    return data[: len(MAGIC)] == MAGIC


def encrypt_bytes(keys: UserKeys, field: str, plain: bytes, nonce: bytes | None = None) -> bytes:
    iv = nonce if nonce is not None else os.urandom(NONCE_BYTES)
    if len(iv) != NONCE_BYTES:
        raise ValueError("A nonce is 12 bytes.")
    return MAGIC + iv + AESGCM(keys.enc).encrypt(iv, plain, field.encode("utf-8"))


def decrypt_bytes(keys: UserKeys, field: str, sealed: bytes) -> bytes:
    """Opens bytes sealed by encryptBytes for the same field. Raises if they were altered, moved or are not sealed."""
    if not is_sealed_bytes(sealed):
        raise ValueError("Not a sealed file.")
    start = len(MAGIC) + NONCE_BYTES
    if len(sealed) < start + 16:
        raise ValueError("Sealed file is too short.")
    return AESGCM(keys.enc).decrypt(sealed[len(MAGIC) : start], sealed[start:], field.encode("utf-8"))


def encrypt_optional(keys: UserKeys, field: str, plaintext: str | None) -> str | None:
    return None if plaintext is None else encrypt_field(keys, field, plaintext)


def decrypt_optional(keys: UserKeys, field: str, payload: str | None) -> str | None:
    return None if payload is None else decrypt_field(keys, field, payload)


def _mac(index_key: bytes, value: str) -> str:
    mac = hmac.new(index_key, value.strip().encode("utf-8"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).decode("ascii").rstrip("=")


def blind_index(keys: UserKeys, value: str) -> str:
    return _mac(keys.index, value)


def team_blind_index(keys: TeamKeys, value: str) -> str:
    """blind_index under a team's index key: one token across the team, never equal to a user's."""
    return _mac(keys.index, value)


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


# The same keys under a team's index key, with the same normalisation (see packages/crypto/src/addresses.ts).
def team_address_index(keys: TeamKeys, value: str) -> str:
    return team_blind_index(keys, address_key(value))


def team_domain_index(keys: TeamKeys, value: str) -> str:
    return team_blind_index(keys, domain_key(value))


# --- Connector credentials, sealed under the user's own key ---------------------------------------------
# Sign-ins and sessions are "v2:" + base64(iv 12 | GCM tag 16 | ciphertext), AES-256-GCM under a key derived from
# the user's data key (HKDF-SHA256, salt 32 zero bytes, info below) with "account:<account id>" as additional data,
# the format of packages/crypto/src/wrap.ts (sealCredential). packages/crypto/credential-vectors.json pins it.

CREDENTIAL_PREFIX = "v2:"
CRED_INFO = b"messages/credential-seal/v1"


def derive_credential_key(data_key: bytes) -> bytes:
    if len(data_key) != 32:
        raise ValueError("A data key is 32 bytes.")
    return _hkdf(data_key, CRED_INFO)


def seal_credential(cred_key: bytes, account_id: str, plaintext: str, iv: bytes | None = None) -> str:
    nonce = iv if iv is not None else os.urandom(NONCE_BYTES)
    if len(nonce) != NONCE_BYTES:
        raise ValueError("A nonce is 12 bytes.")
    sealed = AESGCM(cred_key).encrypt(nonce, plaintext.encode("utf-8"), f"account:{account_id}".encode("utf-8"))
    # AESGCM puts the tag after the ciphertext; the layout has it first.
    return CREDENTIAL_PREFIX + base64.b64encode(nonce + sealed[-16:] + sealed[:-16]).decode("ascii")


def open_credential(cred_key: bytes, account_id: str, payload: str) -> str:
    if not payload.startswith(CREDENTIAL_PREFIX):
        raise ValueError("Not a v2 credential.")
    raw = base64.b64decode(payload[len(CREDENTIAL_PREFIX):])
    if len(raw) < 28:
        raise ValueError("Credential is too short.")
    iv, tag, body = raw[:12], raw[12:28], raw[28:]
    return AESGCM(cred_key).decrypt(iv, body + tag, f"account:{account_id}".encode("utf-8")).decode("utf-8")
