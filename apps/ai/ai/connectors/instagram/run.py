"""Runs the Instagram connector: one thread per connected Instagram account, started and stopped as accounts
are connected, paused and connected again in the app. Stop with Ctrl+C.

A Business or Creator account (credentials kind "official") is synced by official.py on Instagram's
official API; a personal one (kind "private", or none) by sync.py through instagrapi.

An account runs while its status is connecting, syncing or connected and a sign-in is saved for it. When
the app saves a new sign-in (Connect in Settings), its account_credentials.updated_at moves and the
account starts again with it. An account in error stays stopped until then."""

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
from ...flags import DISABLE_INSTAGRAM, flags_for
from ...supabase import Supabase, missing_relation
from ...vault import Vault
from .credentials import OFFICIAL, kind_of
from .official import OfficialSync
from ..tempdirs import sweep_stale
from .store import Store
from .sync import AccountSync, Settings

RECONCILE_S = 60.0  # the first reconcile runs at once on start; accounts are connected or paused rarely
RESTART_AFTER_S = 600.0  # an account whose thread died on its own is started again after this long
RUNNING = ("connecting", "syncing", "connected")


@dataclass(frozen=True)
class Config:
    supabase_url: str
    service_role_key: str
    encryption_key: str  # the sync worker's old ENCRYPTION_KEY, only for "v1:" sign-ins and sessions not yet resealed; may be empty
    key_wrapping_key: str
    encrypt_content: bool
    encrypt_addresses: bool
    proxy: str | None
    initial_sync_days: int


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
    check_encryption(flag_on("ENCRYPT_CONTENT"), flag_on("ENCRYPT_ADDRESSES"))
    return Config(
        supabase_url=required("SUPABASE_URL"),
        service_role_key=required("SUPABASE_SERVICE_ROLE_KEY"),
        # Optional: only reads sign-ins sealed before per-user keys. Unset once `pnpm --filter worker keys:readiness` reports none.
        encryption_key=os.environ.get("ENCRYPTION_KEY", "").strip(),
        key_wrapping_key=wrapping_key,
        encrypt_content=flag_on("ENCRYPT_CONTENT"),
        encrypt_addresses=flag_on("ENCRYPT_ADDRESSES"),
        proxy=os.environ.get("INSTAGRAM_PROXY", "").strip() or None,
        initial_sync_days=int(os.environ.get("INITIAL_SYNC_DAYS", "30") or 30),
    )


@dataclass
class Running:
    thread: threading.Thread
    stop: threading.Event
    credentials_at: str
    ended_at: float | None = None


class Accounts:
    def __init__(self, store: Store, settings: Settings):
        self.store = store
        self.settings = settings
        self.running: dict[str, Running] = {}
        self.lock = threading.Lock()

    def reconcile(self) -> None:
        rows = self.store.accounts()
        seen = set()
        for row in rows:
            account_id = row["id"]
            seen.add(account_id)
            creds = row.get("account_credentials")
            updated = (creds[0] if isinstance(creds, list) and creds else creds or {}).get("updated_at")
            wanted = row.get("status") in RUNNING and bool(updated) and not self.switched_off(row)
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

    def switched_off(self, row: dict[str, Any]) -> bool:
        """Whether the owner's kill switch (Admin, Flags) has Instagram off for this account's person. A paused account is halted like one the person paused."""
        db = getattr(self.store, "db", None)
        return db is not None and flags_for(db).is_on(DISABLE_INSTAGRAM, row.get("user_id"))

    def start(self, account: dict[str, Any], credentials_at: str) -> None:
        stop = threading.Event()

        def moved(updated: str | None) -> None:
            # The connector rewrote its own sign-in (the password is dropped once used): not a new sign-in.
            with self.lock:
                entry = self.running.get(account["id"])
                if entry and updated:
                    entry.credentials_at = updated

        try:
            creds, _ = self.store.credentials(account["id"])
        except Exception:
            creds = None  # unreadable credentials are the private sync's to report
        # One provider, two kinds: a Business or Creator account on the official API, or a personal one through instagrapi.
        kind = OfficialSync if kind_of(creds) == OFFICIAL else AccountSync
        sync = kind(self.store, account, self.settings, stop, on_credentials=moved)
        thread = threading.Thread(target=sync.run, name=f"instagram-{account['id'][:8]}", daemon=True)
        with self.lock:
            self.running[account["id"]] = Running(thread, stop, credentials_at)
        thread.start()
        log.info("instagram account started", account=account["id"])

    def halt(self, account_id: str) -> None:
        with self.lock:
            entry = self.running.pop(account_id, None)
        if entry:
            entry.stop.set()
            log.info("instagram account stopped", account=account_id)

    def halt_all(self) -> None:
        for account_id in list(self.running):
            self.halt(account_id)


def main() -> None:
    cfg = load()
    db = Supabase(cfg.supabase_url, cfg.service_role_key)
    vault = Vault(db, cfg.key_wrapping_key, cfg.encrypt_content, encrypt_addresses=cfg.encrypt_addresses)
    store = Store(db, vault, encryption_key=cfg.encryption_key, key_wrapping_key=cfg.key_wrapping_key, encrypt_addresses=cfg.encrypt_addresses)
    accounts = Accounts(store, Settings(proxy=cfg.proxy, initial_sync_days=cfg.initial_sync_days))
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    log.info("instagram connector starting", proxy=bool(cfg.proxy), encrypt_content=cfg.encrypt_content, encrypt_addresses=cfg.encrypt_addresses)
    sweep_stale("konva-ig-")  # outgoing files left by a run that was killed before it could tidy up
    try:
        while not stop.is_set():
            try:
                accounts.reconcile()
                store.clear_stale_codes()
            except Exception as err:
                if missing_relation(err):  # the Instagram migration is not applied yet
                    log.warn("instagram tables missing", code=log.code_of(err))
                    stop.wait(600)
                    continue
                log.error("instagram reconcile failed", code=log.code_of(err))
            stop.wait(RECONCILE_S)
    except KeyboardInterrupt:
        pass
    accounts.halt_all()
    log.info("instagram connector stopping")
