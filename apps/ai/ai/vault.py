"""Opening and sealing encrypted fields with each user's keys.

Every read of an encrypted column goes through open before the text is used, and every write of one
through seal. A value that is not ciphertext (older rows, or a user whose writes are still plaintext)
passes through unchanged, so the worker reads mixed tables without caring which rows are which.

The AI worker never creates keys: the sync worker does when a user's first message arrives. A user
with no key yet is asked about again after MISSING_RECHECK_S, so their keys are picked up without a
restart. Nothing logged here ever includes a value."""

from __future__ import annotations

import threading
import time
from typing import Any

from . import log
from .crypto import UserKeys, decrypt_field, derive_user_keys, encrypt_field, is_ciphertext
from .keys import unwrap

MISSING_RECHECK_S = 60


class Vault:
    def __init__(self, db: Any, master_key_b64: str | None = None, encrypt: bool = False):
        self.db = db
        self.master_key_b64 = master_key_b64 or ""
        self.encrypt = encrypt
        self._lock = threading.Lock()
        self._keys: dict[str, UserKeys] = {}
        self._missing: dict[str, float] = {}  # user_id -> monotonic time to look for their key again

    def keys_for(self, user_id: str) -> UserKeys | None:
        """The user's derived keys, read once and cached. None when they have no usable key yet. The read
        happens outside the lock, so one slow read never holds up threads whose keys are cached."""
        with self._lock:
            if user_id in self._keys:
                return self._keys[user_id]
            if time.monotonic() < self._missing.get(user_id, 0.0):
                return None
        row = self.db.first("user_keys", {"select": "wrapped_key,wrapped_by", "user_id": f"eq.{user_id}"})
        keys = None
        if row:
            try:
                keys = derive_user_keys(unwrap(row, self.master_key_b64, user_id))
            except Exception as err:
                # A missing or wrong KEY_WRAPPING_KEY, or a wrapper this worker does not know.
                log.warn("user key could not be unwrapped", user=user_id, code=type(err).__name__)
        with self._lock:
            if keys is None:
                self._missing[user_id] = time.monotonic() + MISSING_RECHECK_S
            else:
                self._keys[user_id] = keys
                self._missing.pop(user_id, None)
        return keys

    def open(self, user_id: str, field: str, value: Any) -> Any:
        """The plaintext of value. None and plaintext come back as they are; ciphertext that cannot be
        opened comes back as "", so a bad row is treated as empty rather than sent anywhere as is."""
        if value is None or not is_ciphertext(value):
            return value
        keys = self.keys_for(user_id)
        if keys is None:
            log.warn("field could not be opened", user=user_id, field=field, code="no_key")
            return ""
        try:
            return decrypt_field(keys, field, value)
        except Exception as err:
            log.warn("field could not be opened", user=user_id, field=field, code=type(err).__name__)
            return ""

    def open_row(self, user_id: str, row: dict[str, Any] | None, columns: list[tuple[str, str]]) -> dict[str, Any] | None:
        """Opens the given (column, field) pairs of row in place and returns it. Missing columns are skipped."""
        if not row:
            return row
        for column, field in columns:
            if column in row:
                row[column] = self.open(user_id, field, row[column])
        return row

    def seal(self, user_id: str, field: str, value: str | None) -> str | None:
        """value encrypted for writing when ENCRYPT_CONTENT is on and the user has keys; otherwise as it is."""
        if value is None or not self.encrypt:
            return value
        keys = self.keys_for(user_id)
        return value if keys is None else encrypt_field(keys, field, value)
