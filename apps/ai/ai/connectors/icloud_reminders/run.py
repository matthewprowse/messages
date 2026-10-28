"""Runs the iCloud Reminders connector: one thread per connected iCloud Reminders account, started and stopped
as accounts are connected, paused and connected again in the app. Stop with Ctrl+C.

An account runs while its status is connecting, syncing or connected and a web sign-in (kind "web") is saved
for it. When the app saves a new sign-in (Connect in Settings), its account_credentials.updated_at moves and
the account starts again with it. An account in error stays stopped until then. An account paired with the
Mac relay (no kind) is left to the sync worker."""

from __future__ import annotations

import os
import signal
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ... import log
from ...config import _load_env_file, check_encryption, flag_on
from ...supabase import Supabase, missing_relation
from ...vault import Vault
from .store import Store
from .sync import AccountSync

RECONCILE_S = 15.0
RESTART_AFTER_S = 600.0  # an account whose thread died on its own is started again after this long
RUNNING = ("connecting", "syncing", "connected")


@dataclass(frozen=True)
class Config:
    supabase_url: str
    service_role_key: str
    encryption_key: str  # the sync worker's ENCRYPTION_KEY, for sign-ins and sessions
    key_wrapping_key: str
    encrypt_content: bool


def load() -> Config:
    _load_env_file(Path(__file__).resolve().parents[3] / ".env")

    def required(name: str) -> str:
        value = os.environ.get(name, "").strip()
        if not value:
            print(f"Missing {name} in apps/ai/.env", file=sys.stderr)
            sys.exit(1)
        return value

    wrapping_key = os.environ.get("KEY_WRAPPING_KEY", "").strip()
    if not wrapping_key and not os.environ.get("KMS_KEY_NAME", "").strip():
        print("Missing KMS_KEY_NAME or KEY_WRAPPING_KEY in apps/ai/.env", file=sys.stderr)
        sys.exit(1)
    check_encryption(flag_on("ENCRYPT_CONTENT"), True)
    return Config(
        supabase_url=required("SUPABASE_URL"),
        service_role_key=required("SUPABASE_SERVICE_ROLE_KEY"),
        encryption_key=required("ENCRYPTION_KEY"),
        key_wrapping_key=wrapping_key,
        encrypt_content=flag_on("ENCRYPT_CONTENT"),
    )


@dataclass
class Running:
    thread: threading.Thread
    stop: threading.Event
    credentials_at: str
    ended_at: float | None = None


class Accounts:
    def __init__(self, store: Store):
        self.store = store
        self.running: dict[str, Running] = {}
        self.lock = threading.Lock()
        self.kinds: dict[str, tuple[str, bool]] = {}  # per account: the sign-in last looked at, and whether it is a web one

    def is_web(self, account_id: str, updated: str) -> bool:
        """Whether the saved sign-in is this connector's (kind "web") and not the Mac relay's. Read once per saved sign-in."""
        known = self.kinds.get(account_id)
        if known and known[0] == updated:
            return known[1]
        web = self.store.kind(account_id) == "web"
        self.kinds[account_id] = (updated, web)
        return web

    def reconcile(self) -> None:
        rows = self.store.accounts()
        seen = set()
        for row in rows:
            account_id = row["id"]
            seen.add(account_id)
            creds = row.get("account_credentials")
            updated = (creds[0] if isinstance(creds, list) and creds else creds or {}).get("updated_at")
            wanted = row.get("status") in RUNNING and bool(updated) and self.is_web(account_id, str(updated))
            with self.lock:
                current = self.running.get(account_id)
            if current and (not wanted or current.credentials_at != updated):
                self.halt(account_id)
                current = None
            if not wanted:
                continue
            if current and current.thread.is_alive():
                continue
            if current:  # it ended without being stopped: an error it could not get past
                if current.ended_at is None:
                    current.ended_at = time.monotonic()
                if time.monotonic() - current.ended_at < RESTART_AFTER_S:
                    continue
            self.start({"id": account_id, "user_id": row["user_id"]}, str(updated))
        for account_id in [a for a in self.running if a not in seen]:
            self.halt(account_id)

    def start(self, account: dict[str, Any], credentials_at: str) -> None:
        stop = threading.Event()

        def moved(updated: str | None) -> None:
            # The connector rewrote its own sign-in (the password is dropped once used): not a new sign-in.
            with self.lock:
                entry = self.running.get(account["id"])
                if entry and updated:
                    entry.credentials_at = updated

        sync = AccountSync(self.store, account, stop, on_credentials=moved)
        thread = threading.Thread(target=sync.run, name=f"icloud-reminders-{account['id'][:8]}", daemon=True)
        with self.lock:
            self.running[account["id"]] = Running(thread, stop, credentials_at)
        thread.start()
        log.info("icloud reminders account started", account=account["id"])

    def halt(self, account_id: str) -> None:
        with self.lock:
            entry = self.running.pop(account_id, None)
        if entry:
            entry.stop.set()
            log.info("icloud reminders account stopped", account=account_id)

    def halt_all(self) -> None:
        for account_id in list(self.running):
            self.halt(account_id)


def main() -> None:
    cfg = load()
    db = Supabase(cfg.supabase_url, cfg.service_role_key)
    vault = Vault(db, cfg.key_wrapping_key, cfg.encrypt_content)
    accounts = Accounts(Store(db, vault, encryption_key=cfg.encryption_key))
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    log.info("icloud reminders connector starting", encrypt_content=cfg.encrypt_content)
    try:
        while not stop.is_set():
            try:
                accounts.reconcile()
            except Exception as err:
                if missing_relation(err):  # a table this needs is not in the database yet
                    log.warn("icloud reminders tables missing", code=log.code_of(err))
                    stop.wait(600)
                    continue
                log.error("icloud reminders reconcile failed", code=log.code_of(err))
            stop.wait(RECONCILE_S)
    except KeyboardInterrupt:
        pass
    accounts.halt_all()
    log.info("icloud reminders connector stopping")
