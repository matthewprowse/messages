"""The AI worker's lease, like the sync worker's (apps/worker/src/lease.ts): one AI worker runs at a time, so a rolling
restart or a mistaken second `pnpm ai` cannot double the Gemini spend. The lease "ai" is taken at start for LEASE_TTL_S,
renewed every RENEW_S in a thread of its own and released on shutdown; a crashed worker's lease expires on its own.

Until the worker_leases migration is applied the worker runs without a lease and says so. If the lease is lost (taken by
another holder, or renewals failing for a whole TTL) the worker stops rather than run twice."""

from __future__ import annotations

import threading
import uuid
from typing import Any, Callable

from . import log
from .supabase import missing_relation

NAME = "ai"
LEASE_TTL_S = 90
RENEW_S = 30


class Lease:
    def __init__(self, db: Any, name: str = NAME, holder: str | None = None, ttl_s: int = LEASE_TTL_S):
        self.db = db
        self.name = name
        self.holder = holder or uuid.uuid4().hex
        self.ttl_s = ttl_s
        self.enabled = True  # False once the migration is known to be missing
        self._misses = 0

    def acquire(self) -> bool:
        """True when this process holds the lease (also when leases are not set up yet: nothing to guard with)."""
        try:
            held = self.db.rpc("acquire_worker_lease", {"p_name": self.name, "p_holder": self.holder, "p_ttl_seconds": self.ttl_s})
        except Exception as err:
            if missing_relation(err):
                self.enabled = False
                log.warn("worker lease not available, running without one (apply the worker_leases migration)")
                return True
            raise
        return bool(held)

    def renew(self) -> bool:
        """One renewal. False when someone else holds the lease, or when renewals have failed for a whole TTL (a
        single failed call is only a miss: the lease is still ours until it expires)."""
        if not self.enabled:
            return True
        try:
            held = self.acquire()
        except Exception as err:
            self._misses += 1
            log.warn("lease renewal failed", code=log.code_of(err), misses=self._misses)
            return self._misses * RENEW_S < self.ttl_s
        if held:
            self._misses = 0
        return held

    def release(self) -> None:
        if not self.enabled:
            return
        try:
            self.db.rpc("release_worker_lease", {"p_name": self.name, "p_holder": self.holder})
        except Exception:
            pass  # it expires on its own

    def keep(self, stop: threading.Event, on_lost: Callable[[], None], every_s: float = RENEW_S) -> threading.Thread:
        """Renews in the background until stop is set; calls on_lost and ends if the lease is lost."""

        def loop() -> None:
            while not stop.wait(every_s):
                if not self.renew():
                    log.error("ai worker lease lost, stopping")
                    on_lost()
                    return

        thread = threading.Thread(target=loop, name="lease", daemon=True)
        thread.start()
        return thread
