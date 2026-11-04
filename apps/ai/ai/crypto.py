"""Field encryption, the same format as packages/crypto/src/index.ts (the browser and the Node worker).

A value is stored as "e1:" + base64(nonce 12 bytes | ciphertext | GCM tag 16 bytes), AES-256-GCM, with the
field it belongs to ("messages.body_text") as additional data. A user's encryption and blind-index keys are
derived from their 32-byte data key with HKDF-SHA256. packages/crypto/vectors.json pins the format for both.

A team (workspace) has a data key of its own. A value sealed with it is "t1:" plus the same layout and the same
field additional data, under keys derived with their own HKDF info strings, so a team key is never a user key.
Readers pick the key by the prefix: e1 is the user's, t1 the team's of the row's workspace.

A user's data key can be rotated (apps/worker/src/rekey): meanwhile UserKeys.older holds the other key's field key, tried
after the current one when opening, and the blind indexes stay under the index key the user's tokens were first made with
(derive_user_keyring), as in packages/crypto/src/index.ts. keyring-vectors.json pins it for both.

"e1:", "t1:" and "e1b:" are the legacy formats, bound only to the field kind. New values are bound to their owner and
place (packages/crypto/src/bound.ts): "e2:"/"t2:" + base64(place length | place | row length | row | nonce | ciphertext
| tag) with "e2|user:<id>|<field>|<place>|<row>" as additional data, and "e2b:" files bound to "<bucket>/<path>".
Readers open both; open_expected is the strict read for columns that drive an action. bound-vectors.json pins it."""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
from dataclasses import dataclass
from typing import Any, Callable

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

PREFIX = "e1:"
TEAM_PREFIX = "t1:"
BOUND_PREFIX = "e2:"
TEAM_BOUND_PREFIX = "t2:"
ENC_INFO = b"messages/field-encryption/v1"
INDEX_INFO = b"messages/blind-index/v1"
TEAM_ENC_INFO = b"messages/team-field-encryption/v1"
TEAM_INDEX_INFO = b"messages/team-blind-index/v1"
NONCE_BYTES = 12


@dataclass(frozen=True)
class UserKeys:
    enc: bytes
    index: bytes
    older: tuple[bytes, ...] = ()  # field keys of older data keys during a rotation: they open, never seal
    owner: str | None = None  # the user these keys are for: bound values (e2:) name it; without it only e1 opens


@dataclass(frozen=True)
class TeamKeys:
    enc: bytes
    index: bytes
    owner: str | None = None  # the workspace these keys are for: bound team values (t2:) name it


class BoundError(ValueError):
    """A bound value refused or unreadable. str() is the stable code (sealed_elsewhere, plaintext_refused, legacy_value,
    team_value_refused, sealed_mismatch, no_owner, no_place, bad_place, unreadable), never a value."""

    @property
    def code(self) -> str:
        return str(self)


@dataclass(frozen=True)
class KeySet:
    """The keys a reader holds, whichever it has: the user's, and the team's when they are in a workspace."""

    user: UserKeys | None = None
    team: TeamKeys | None = None


def _hkdf(data_key: bytes, info: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=bytes(32), info=info).derive(data_key)


def derive_user_keys(data_key: bytes, owner: str | None = None) -> UserKeys:
    """A user's field and index keys, for owner (their user id) when given."""
    if len(data_key) != 32:
        raise ValueError("A data key is 32 bytes.")
    return UserKeys(enc=_hkdf(data_key, ENC_INFO), index=_hkdf(data_key, INDEX_INFO), owner=owner)


def derive_index_key(data_key: bytes) -> bytes:
    """The raw index key of a data key, kept (wrapped) when the data key is rotated so index tokens stay the same."""
    if len(data_key) != 32:
        raise ValueError("A data key is 32 bytes.")
    return _hkdf(data_key, INDEX_INFO)


def derive_user_keyring(current: bytes, older: list[bytes] | tuple[bytes, ...] = (), index_key: bytes | None = None, owner: str | None = None) -> UserKeys:
    """A user's keys from their keyring (keys.unwrap_user_ring): current seals and opens, each older key only opens, and
    index_key (from derive_index_key) makes the blind indexes; without one they come from current."""
    keys = derive_user_keys(current)
    if index_key is not None and len(index_key) != 32:
        raise ValueError("An index key is 32 bytes.")
    return UserKeys(enc=keys.enc, index=index_key if index_key is not None else keys.index, older=tuple(derive_user_keys(k).enc for k in older), owner=owner)


def _first_that_opens(keys: UserKeys, open_with: Callable[[bytes], Any]) -> Any:
    """Tries the current key, then each older one, and raises the current key's error when none opens."""
    try:
        return open_with(keys.enc)
    except Exception as first:
        for old in keys.older:
            try:
                return open_with(old)
            except Exception:
                continue
        raise first


def derive_team_keys(data_key: bytes, workspace_id: str | None = None) -> TeamKeys:
    """A workspace's field and index keys, for workspace_id when given."""
    if len(data_key) != 32:
        raise ValueError("A data key is 32 bytes.")
    return TeamKeys(enc=_hkdf(data_key, TEAM_ENC_INFO), index=_hkdf(data_key, TEAM_INDEX_INFO), owner=workspace_id)


def is_ciphertext(value: object) -> bool:
    """Whether a stored value is sealed, with a user's key (e1:, e2:) or a team's (t1:, t2:)."""
    return isinstance(value, str) and value[:3] in (PREFIX, BOUND_PREFIX, TEAM_PREFIX, TEAM_BOUND_PREFIX)


def is_team_ciphertext(value: object) -> bool:
    return isinstance(value, str) and value[:3] in (TEAM_PREFIX, TEAM_BOUND_PREFIX)


def is_legacy_ciphertext(value: object) -> bool:
    """Whether a stored value is in a legacy format (e1:, t1:) that names no owner or place."""
    return isinstance(value, str) and value[:3] in (PREFIX, TEAM_PREFIX)


# --- Bound values (packages/crypto/src/bound.ts) -----------------------------------------------------------------
_PLACE = re.compile(r"([a-z0-9_]+\.[a-z0-9_]+)?")
_ROW = re.compile(r"[A-Za-z0-9_.:/@ -]*")


def _owner_tag(keys: UserKeys | TeamKeys) -> str:
    if not keys.owner:
        raise BoundError("no_owner")
    return f"{'team' if isinstance(keys, TeamKeys) else 'user'}:{keys.owner}"


def _field_aad(prefix: str, owner: str, field: str, place: str, row: str) -> bytes:
    return f"{prefix[:2]}|{owner}|{field}|{place}|{row}".encode("utf-8")


def _seal_placed(enc: bytes, prefix: str, owner: str, field: str, place: str, row: str | None, plaintext: str, nonce: bytes | None) -> str:
    row = row or ""
    if not _PLACE.fullmatch(place) or len(place) > 100 or not _ROW.fullmatch(row) or len(row) > 200:
        raise BoundError("bad_place")
    iv = nonce if nonce is not None else os.urandom(NONCE_BYTES)
    if len(iv) != NONCE_BYTES:
        raise ValueError("A nonce is 12 bytes.")
    p, r = place.encode("utf-8"), row.encode("utf-8")
    sealed = AESGCM(enc).encrypt(iv, plaintext.encode("utf-8"), _field_aad(prefix, owner, field, place, row))
    return prefix + base64.b64encode(bytes([len(p)]) + p + bytes([len(r)]) + r + iv + sealed).decode("ascii")


def _parse_placed(payload: str) -> tuple[str, str, bytes, bytes]:
    raw = base64.b64decode(payload[3:])
    p_len = raw[0] if raw else 0
    r_at = 1 + p_len
    r_len = raw[r_at] if len(raw) > r_at else 0
    iv_at = r_at + 1 + r_len
    if len(raw) < iv_at + NONCE_BYTES + 16:
        raise BoundError("unreadable")
    return raw[1:r_at].decode("utf-8"), raw[r_at + 1 : iv_at].decode("utf-8"), raw[iv_at : iv_at + NONCE_BYTES], raw[iv_at + NONCE_BYTES :]


def place_of(payload: object) -> tuple[str, str] | None:
    """(place, row) a bound value says it was sealed for, or None. Unauthenticated until the value opens."""
    if not isinstance(payload, str) or payload[:3] not in (BOUND_PREFIX, TEAM_BOUND_PREFIX):
        return None
    try:
        place, row, _, _ = _parse_placed(payload)
        return place, row
    except Exception:
        return None


def check_expected(place: str, row: str, places: list[str] | tuple[str, ...], expect_row: str | None) -> None:
    """Refuses a bound value sealed for another place or row (sealed_elsewhere). expect_row None: the row is not checked."""
    if place not in places or (expect_row is not None and row != expect_row):
        raise BoundError("sealed_elsewhere")


def _open_placed(enc: bytes, prefix: str, owner: str, field: str, payload: str, places: list[str] | tuple[str, ...] | None, expect_row: str | None) -> str:
    place, row, iv, body = _parse_placed(payload)
    if places is not None:
        check_expected(place, row, places, expect_row)
    return AESGCM(enc).decrypt(iv, body, _field_aad(prefix, owner, field, place, row)).decode("utf-8")


def encrypt_at(keys: UserKeys, field: str, place: str, row: str | None, plaintext: str, nonce: bytes | None = None) -> str:
    """Seals text bound to the keys' user, the field and its place ("table.column") and row: "e2:"."""
    return _seal_placed(keys.enc, BOUND_PREFIX, _owner_tag(keys), field, place, row, plaintext, nonce)


def encrypt_team_at(keys: TeamKeys, field: str, place: str, row: str | None, plaintext: str, nonce: bytes | None = None) -> str:
    """encrypt_at with a team's key: "t2:", bound to the keys' workspace."""
    return _seal_placed(keys.enc, TEAM_BOUND_PREFIX, _owner_tag(keys), field, place, row, plaintext, nonce)


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


def decrypt_field(keys: UserKeys, field: str, payload: str, places: list[str] | tuple[str, ...] | None = None, row: str | None = None) -> str:
    """Opens a user's value (e1:, or e2: for the keys' user) sealed for this field with the current key or, during a
    rotation, an older one. places (and row) are checked against a bound value's header first."""
    if isinstance(payload, str) and payload.startswith(BOUND_PREFIX):
        owner = _owner_tag(keys)
        return _first_that_opens(keys, lambda enc: _open_placed(enc, BOUND_PREFIX, owner, field, payload, places, row))
    if not isinstance(payload, str) or not payload.startswith(PREFIX):
        raise ValueError("Not an encrypted value.")
    return _first_that_opens(keys, lambda enc: _unseal(enc, PREFIX, field, payload))


def encrypt_team_field(keys: TeamKeys, field: str, plaintext: str, nonce: bytes | None = None) -> str:
    """encrypt_field with a team's key: the same layout and field additional data, marked "t1:"."""
    return _seal(keys.enc, TEAM_PREFIX, field, plaintext, nonce)


def decrypt_team_field(keys: TeamKeys, field: str, payload: str, places: list[str] | tuple[str, ...] | None = None, row: str | None = None) -> str:
    if isinstance(payload, str) and payload.startswith(TEAM_BOUND_PREFIX):
        return _open_placed(keys.enc, TEAM_BOUND_PREFIX, _owner_tag(keys), field, payload, places, row)
    if not isinstance(payload, str) or not payload.startswith(TEAM_PREFIX):
        raise ValueError("Not a team encrypted value.")
    return _unseal(keys.enc, TEAM_PREFIX, field, payload)


def decrypt_any(keys: KeySet, field: str, payload: str) -> str:
    """Decrypts a field of either kind, choosing the key by its prefix: e1/e2 with the user's keys, t1/t2 with the
    team's. Raises a clear error when the key it needs is not held."""
    if is_team_ciphertext(payload):
        if keys.team is None:
            raise ValueError("A team value needs the team's keys.")
        return decrypt_team_field(keys.team, field, payload)
    if keys.user is None:
        raise ValueError("A user value needs the user's keys.")
    return decrypt_field(keys.user, field, payload)


def open_expected(keys: UserKeys, field: str, value: str | None, places: list[str] | tuple[str, ...], row: str | None, sealed: bool, legacy: bool) -> str | None:
    """The plain text of a value in a column that drives an action (openExpected in index.ts), or BoundError: plain text
    when the column must be sealed (sealed), a legacy e1 value once they are refused (not legacy), a team value, or a
    value sealed for another place or row. Never "" for a value that will not open. None stays None."""
    if value is None:
        return None
    if not is_ciphertext(value):
        if sealed:
            raise BoundError("plaintext_refused")
        return value
    if is_team_ciphertext(value):
        raise BoundError("team_value_refused")
    if is_legacy_ciphertext(value) and not legacy:
        raise BoundError("legacy_value")
    return decrypt_field(keys, field, value, places, row)


# Sealed files (encryptBytes in index.ts): MAGIC, a 12-byte nonce, then ciphertext and its 16-byte tag, with
# the field as additional data. MAGIC is "e1b:" 00 FF "KN"; a bound file (encryptBytesAt) starts "e2b:" 00 FF "KN"
# and its additional data is "e2b|user:<id>|<field>|<bucket>/<path>".
MAGIC = bytes([0x65, 0x31, 0x62, 0x3A, 0x00, 0xFF, 0x4B, 0x4E])
BOUND_MAGIC = bytes([0x65, 0x32, 0x62, 0x3A, 0x00, 0xFF, 0x4B, 0x4E])


def is_sealed_bytes(data: bytes) -> bool:
    return data[: len(MAGIC)] in (MAGIC, BOUND_MAGIC)


def is_legacy_bytes(data: bytes) -> bool:
    return data[: len(MAGIC)] == MAGIC


def _file_aad(owner: str, field: str, where: str) -> bytes:
    return f"e2b|{owner}|{field}|{where}".encode("utf-8")


def encrypt_bytes_at(keys: UserKeys | TeamKeys, field: str, where: str, plain: bytes, nonce: bytes | None = None) -> bytes:
    """Seals a file's bytes bound to the keys' owner and where it is stored ("<bucket>/<path>"): the e2b format."""
    if not where:
        raise BoundError("bad_place")
    iv = nonce if nonce is not None else os.urandom(NONCE_BYTES)
    if len(iv) != NONCE_BYTES:
        raise ValueError("A nonce is 12 bytes.")
    return BOUND_MAGIC + iv + AESGCM(keys.enc).encrypt(iv, plain, _file_aad(_owner_tag(keys), field, where))


def encrypt_bytes(keys: UserKeys, field: str, plain: bytes, nonce: bytes | None = None) -> bytes:
    iv = nonce if nonce is not None else os.urandom(NONCE_BYTES)
    if len(iv) != NONCE_BYTES:
        raise ValueError("A nonce is 12 bytes.")
    return MAGIC + iv + AESGCM(keys.enc).encrypt(iv, plain, field.encode("utf-8"))


def decrypt_bytes(keys: UserKeys, field: str, sealed: bytes, where: str | None = None) -> bytes:
    """Opens bytes sealed by encryptBytes or encryptBytesAt for the same field; a bound file needs where, the place it was
    read from. Raises if they were altered, moved or are not sealed."""
    if not is_sealed_bytes(sealed):
        raise ValueError("Not a sealed file.")
    start = len(MAGIC) + NONCE_BYTES
    if len(sealed) < start + 16:
        raise ValueError("Sealed file is too short.")
    if is_legacy_bytes(sealed):
        aad = field.encode("utf-8")
    elif not where:
        raise BoundError("no_place")
    else:
        aad = _file_aad(_owner_tag(keys), field, where)
    return _first_that_opens(keys, lambda enc: AESGCM(enc).decrypt(sealed[len(MAGIC) : start], sealed[start:], aad))


def decrypt_team_bytes(keys: TeamKeys, field: str, sealed: bytes, where: str | None = None) -> bytes:
    """decrypt_bytes with a team's key (one version)."""
    if not is_sealed_bytes(sealed):
        raise ValueError("Not a sealed file.")
    start = len(MAGIC) + NONCE_BYTES
    if len(sealed) < start + 16:
        raise ValueError("Sealed file is too short.")
    if is_legacy_bytes(sealed):
        aad = field.encode("utf-8")
    elif not where:
        raise BoundError("no_place")
    else:
        aad = _file_aad(_owner_tag(keys), field, where)
    return AESGCM(keys.enc).decrypt(sealed[len(MAGIC) : start], sealed[start:], aad)


def open_file_expected(keys: UserKeys, field: str, data: bytes, where: str, sealed: bool, legacy: bool, flagged: bool | None = None) -> bytes:
    """The plain bytes of a stored file a strict reader uses (openFileExpected in index.ts), or BoundError:
    sealed_mismatch when the row's sealed flag and the header disagree, plaintext_refused, legacy_value."""
    is_sealed = is_sealed_bytes(data)
    if flagged is not None and flagged != is_sealed:
        raise BoundError("sealed_mismatch")
    if not is_sealed:
        if sealed:
            raise BoundError("plaintext_refused")
        return data
    if is_legacy_bytes(data) and not legacy:
        raise BoundError("legacy_value")
    return decrypt_bytes(keys, field, data, where)


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


def group_name_key(value: str) -> str:
    """A group chat's name (threads.group_name_index): not lowercased, so a change of case counts as a rename."""
    return f"group:{value.strip()}"


def address_index(keys: UserKeys, value: str) -> str:
    return blind_index(keys, address_key(value))


def group_name_index(keys: UserKeys, value: str) -> str:
    return blind_index(keys, group_name_key(value))


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


def handoff_context(table: str, column: str, row_id: str) -> str:
    """The additional data of a handoff stored in a table row (handoffContext in packages/crypto/src/wrap.ts)."""
    return f"handoff:{table}.{column}:{row_id.lower()}"


def seal_bound(cred_key: bytes, context: str, plaintext: str, iv: bytes | None = None) -> str:
    """Seals text as "v2:" bound to context: "account:<id>" for a sign-in, handoff_context for a handoff."""
    nonce = iv if iv is not None else os.urandom(NONCE_BYTES)
    if len(nonce) != NONCE_BYTES:
        raise ValueError("A nonce is 12 bytes.")
    sealed = AESGCM(cred_key).encrypt(nonce, plaintext.encode("utf-8"), context.encode("utf-8"))
    # AESGCM puts the tag after the ciphertext; the layout has it first.
    return CREDENTIAL_PREFIX + base64.b64encode(nonce + sealed[-16:] + sealed[:-16]).decode("ascii")


def open_bound(cred_keys: bytes | list[bytes] | tuple[bytes, ...], context: str, payload: str) -> str:
    """Opens a "v2:" value sealed for context with the one key given, or the first of several that opens it (the current
    credential key first, then older ones during a rotation)."""
    if not payload.startswith(CREDENTIAL_PREFIX):
        raise ValueError("Not a v2 credential.")
    raw = base64.b64decode(payload[len(CREDENTIAL_PREFIX):])
    if len(raw) < 28:
        raise ValueError("Credential is too short.")
    iv, tag, body = raw[:12], raw[12:28], raw[28:]
    keys = [cred_keys] if isinstance(cred_keys, bytes) else list(cred_keys)
    if not keys:
        raise ValueError("No credential key.")
    first: Exception | None = None
    for key in keys:
        try:
            return AESGCM(key).decrypt(iv, body + tag, context.encode("utf-8")).decode("utf-8")
        except Exception as err:
            first = first or err
    raise first  # type: ignore[misc]


def seal_credential(cred_key: bytes, account_id: str, plaintext: str, iv: bytes | None = None) -> str:
    return seal_bound(cred_key, f"account:{account_id}", plaintext, iv)


def open_credential(cred_keys: bytes | list[bytes] | tuple[bytes, ...], account_id: str, payload: str) -> str:
    return open_bound(cred_keys, f"account:{account_id}", payload)
