"""Opening and sealing encrypted fields with each user's keys.

Every read of an encrypted column goes through open before the text is used, and every write of one
through seal. A value that is not ciphertext (older rows, or a user whose writes are still plaintext)
passes through unchanged, so the worker reads mixed tables without caring which rows are which.

The AI worker never creates keys: the sync worker does when a user's first message arrives. A user
with no key yet is asked about again after MISSING_RECHECK_S, so their keys are picked up without a
restart. Keys are cached for KEY_CACHE_S (about 10 minutes) and then read again, never written anywhere. A row
sealed with a team key (t1:) is opened with its workspace's keys, read and cached the same way from team_keys (every
version still holding values, the current first: a value sealed before the last rotation opens with an older one until
the sync worker has re-sealed it); a row's workspace_id says which team. Nothing logged here ever includes a value."""

from __future__ import annotations

import threading
import time
from typing import Any

from . import log
from .crypto import KeySet, TeamKeys, UserKeys, decrypt_any, decrypt_bytes, derive_credential_key, derive_team_keys, derive_user_keys, encrypt_field, is_ciphertext, is_sealed_bytes, is_team_ciphertext
from .keys import KEY_CACHE_S, unwrap, unwrap_team_ring

MISSING_RECHECK_S = 60
UNWRAP_RETRY_S = 5  # a key that exists but could not be unwrapped (a KMS blip) is tried again this soon
WORKSPACES_TTL_S = 60
TEAM_RECHECK_S = 30  # a workspace's key versions are read again this often, so a rotation is picked up promptly


class KeyUnavailable(Exception):
    """The user has a key but it cannot be opened right now, so nothing can be sealed (and nothing may be stored plain)."""


class Vault:
    def __init__(self, db: Any, master_key_b64: str | None = None, encrypt: bool = False):
        self.db = db
        self.master_key_b64 = master_key_b64 or ""
        self.encrypt = encrypt
        self._lock = threading.Lock()
        self._keys: dict[str, tuple[float, UserKeys]] = {}  # user_id -> (valid until, keys)
        self._reading: dict[str, threading.Lock] = {}  # user_id -> held while their key is read, so threads asking at once read it once
        self._credential_keys: dict[str, tuple[float, bytes]] = {}
        self._unwrap_failed: dict[str, float] = {}  # user_id -> until when a key that exists but would not unwrap is not retried
        self._missing: dict[str, float] = {}  # user_id -> monotonic time to look for their key again
        self._team_keys: dict[str, tuple[float, list[TeamKeys]]] = {}  # workspace_id -> (valid until, versions newest first)
        self._team_missing: dict[str, float] = {}  # workspace_id -> the same, for a workspace's key
        self._workspaces: dict[str, tuple[float, list[str]]] = {}  # user_id -> (valid until, their workspaces)

    def keys_for(self, user_id: str) -> UserKeys | None:
        """The user's derived keys, read and cached for KEY_CACHE_S. None when they have no usable key yet. The
        read happens outside the lock, so one slow read never holds up threads whose keys are cached; threads that
        need the same user's key at once (a draft's reads run together) wait for one read and KMS unwrap."""
        cached = self._cached_keys(user_id)
        if cached is not False:
            return cached
        with self._lock:
            reading = self._reading.setdefault(user_id, threading.Lock())
        with reading:
            cached = self._cached_keys(user_id)  # read by the thread this one waited for
            if cached is not False:
                return cached
            return self._read_keys(user_id)

    def _cached_keys(self, user_id: str) -> UserKeys | None | bool:
        """The cached keys, None when the user is known to have none for now, or False when they must be read."""
        with self._lock:
            hit = self._keys.get(user_id)
            if hit and hit[0] > time.monotonic():
                return hit[1]
            if time.monotonic() < self._missing.get(user_id, 0.0) or time.monotonic() < self._unwrap_failed.get(user_id, 0.0):
                return None
        return False

    def _read_keys(self, user_id: str) -> UserKeys | None:
        row = self.db.first("user_keys", {"select": "wrapped_key,wrapped_by", "user_id": f"eq.{user_id}"})
        keys = None
        cred = None
        failed = False
        if row:
            try:
                raw = unwrap(row, self.master_key_b64, user_id)
                keys = derive_user_keys(raw)
                cred = derive_credential_key(raw)
            except Exception as err:
                # A missing or wrong KEY_WRAPPING_KEY or KMS setup, or a wrapper this worker does not know.
                log.warn("user key could not be unwrapped", user=user_id, code=type(err).__name__)
                failed = True
        with self._lock:
            if failed:
                # Not "no key": a key exists, so nothing may be written in plain text for them (seal). Looked at again soon.
                self._unwrap_failed[user_id] = time.monotonic() + UNWRAP_RETRY_S
            elif keys is None:
                self._missing[user_id] = time.monotonic() + MISSING_RECHECK_S
            else:
                until = time.monotonic() + KEY_CACHE_S
                self._keys[user_id] = (until, keys)
                self._credential_keys[user_id] = (until, cred)  # type: ignore[arg-type]
                self._missing.pop(user_id, None)
                self._unwrap_failed.pop(user_id, None)
        return keys

    def credential_key_for(self, user_id: str) -> bytes | None:
        """The key that seals the user's connector sign-ins and sessions ("v2:", crypto.seal_credential), cached
        like their other keys. None when they have no usable key yet."""
        if self.keys_for(user_id) is None:
            return None
        with self._lock:
            hit = self._credential_keys.get(user_id)
        return hit[1] if hit else None

    def team_keyring_for(self, workspace_id: str) -> list[TeamKeys]:
        """The workspace's derived keys, one per version still holding values, the current first. Read and cached
        for TEAM_RECHECK_S, like keys_for. Empty when it has no usable key. Each version seals with its own key; the
        blind index always comes from the first version's key (unwrap_team_ring)."""
        with self._lock:
            hit = self._team_keys.get(workspace_id)
            if hit and hit[0] > time.monotonic():
                return hit[1]
            if time.monotonic() < self._team_missing.get(workspace_id, 0.0):
                return []
        rows = self.db.select("team_keys", {"select": "key_version,wrapped_key,wrapped_by,retired_at", "workspace_id": f"eq.{workspace_id}"})
        ring: list[TeamKeys] = []
        if rows:
            try:
                versions, root = unwrap_team_ring(rows, self.master_key_b64, workspace_id)
                index = derive_team_keys(root).index
                ring = [TeamKeys(enc=derive_team_keys(key).enc, index=index) for _, key in versions]
            except Exception as err:
                log.warn("team key could not be unwrapped", workspace=workspace_id, code=type(err).__name__)
        with self._lock:
            if not ring:
                self._team_missing[workspace_id] = time.monotonic() + MISSING_RECHECK_S
            else:
                self._team_keys[workspace_id] = (time.monotonic() + TEAM_RECHECK_S, ring)
                self._team_missing.pop(workspace_id, None)
        return ring

    def team_keys_for(self, workspace_id: str) -> TeamKeys | None:
        """The workspace's current derived keys, or None when it has no usable key."""
        ring = self.team_keyring_for(workspace_id)
        return ring[0] if ring else None

    def workspaces_for(self, user_id: str) -> list[str]:
        """The workspaces a user is or was in, newest first, read from workspace_members and cached briefly
        (who is in a team changes rarely). A team value (t1:) in one of their rows belongs to one of these."""
        now = time.monotonic()
        with self._lock:
            hit = self._workspaces.get(user_id)
            if hit and now < hit[0]:
                return hit[1]
        rows = self.db.select("workspace_members", {"select": "workspace_id", "user_id": f"eq.{user_id}", "order": "created_at.desc"})
        ids = [r["workspace_id"] for r in rows]
        with self._lock:
            self._workspaces[user_id] = (now + WORKSPACES_TTL_S, ids)
        return ids

    def open(self, user_id: str, field: str, value: Any, workspace_id: str | None = None) -> Any:
        """The plaintext of value. None and plaintext come back as they are; ciphertext that cannot be
        opened comes back as "", so a bad row is treated as empty rather than sent anywhere as is. A user's
        value (e1:) opens with their keys, a team's (t1:) with the keys of the row's workspace_id. Most
        reads do not select that column, so without one the user's own workspaces are tried in turn: a team
        value in their row can only be from one of them."""
        if value is None or not is_ciphertext(value):
            return value
        if is_team_ciphertext(value):
            code = "no_team_key"
            for wid in [workspace_id] if workspace_id else self.workspaces_for(user_id):
                for team in self.team_keyring_for(wid):  # the current version first
                    try:
                        return decrypt_any(KeySet(team=team), field, value)
                    except Exception as err:
                        code = type(err).__name__
            log.warn("field could not be opened", user=user_id, field=field, code=code)
            return ""
        user = self.keys_for(user_id)
        if user is None:
            log.warn("field could not be opened", user=user_id, field=field, code="no_key")
            return ""
        try:
            return decrypt_any(KeySet(user=user), field, value)
        except Exception as err:
            log.warn("field could not be opened", user=user_id, field=field, code=type(err).__name__)
            return ""

    def open_bytes(self, user_id: str, field: str, data: bytes) -> bytes | None:
        """The plain bytes of a file the app sealed; unsealed bytes come back as they are. None when it is
        sealed and cannot be opened."""
        if not is_sealed_bytes(data):
            return data
        keys = self.keys_for(user_id)
        if keys is None:
            log.warn("file could not be opened", user=user_id, field=field, code="no_key")
            return None
        try:
            return decrypt_bytes(keys, field, data)
        except Exception as err:
            log.warn("file could not be opened", user=user_id, field=field, code=type(err).__name__)
            return None

    def open_row(self, user_id: str, row: dict[str, Any] | None, columns: list[tuple[str, str]]) -> dict[str, Any] | None:
        """Opens the given (column, field) pairs of row in place and returns it. Missing columns are skipped.
        The row's workspace_id, when it has one, says which team a t1: value belongs to."""
        if not row:
            return row
        workspace_id = row.get("workspace_id")
        for column, field in columns:
            if column in row:
                row[column] = self.open(user_id, field, row[column], workspace_id)
        return row

    def seal(self, user_id: str, field: str, value: str | None) -> str | None:
        """value encrypted for writing when ENCRYPT_CONTENT is on and the user has keys; otherwise as it is."""
        if value is None or not self.encrypt:
            return value
        keys = self.keys_for(user_id)
        if keys is None:
            if self._unwrap_failed.get(user_id, 0.0) > 0.0:
                raise KeyUnavailable("user key exists but could not be unwrapped")  # never fall back to plain text for them
            return value
        return encrypt_field(keys, field, value)
