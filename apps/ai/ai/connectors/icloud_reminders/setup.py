"""One iCloud sign-in for Mail, Calendar and Reminders: the job behind Connect iCloud in the app.

The app queues a row in public.icloud_setups with the Apple ID and password (sealed under the static key, as
sign-in codes are) and what the person ticked. When Mail or Calendar is ticked, this signs in to the account
page (account_site), asks for the code in the app exactly as Reminders does (signin.sign_in, with the step
written to the setup row), makes an app-specific password labelled "Konva", and hands it back sealed with the
sign-in's trust token. The app then checks the password with iCloud Mail and Calendar and saves them as it saves
a pasted one, and starts Reminders with the trust token so Apple may not ask for a second code. The session
here is thrown away as soon as the password is made: nothing that reaches the whole Apple Account is kept for
Mail and Calendar.

  status queued → signing_in → ready (the app takes it) or failed (error is the plain reason)

Rows are the app's to delete once used; an old one left behind is deleted here after an hour. Only IDs and
failure codes are logged."""

from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from ... import log
from ...supabase import Supabase, SupabaseError, missing_relation
from ..instagram.sealing import open_json, seal_json
from .account_site import AppPasswordFailed, AccountSite, make_account_api, trust_token
from .session import SessionDir
from .signin import SignInFailed, SignInStopped, sign_in

TABLE = "icloud_setups"
POLL_S = 3.0
STALE_S = 30 * 60.0  # a sign-in claimed this long ago and never finished has stopped (the worker restarted)
KEEP_S = 60 * 60.0  # any row older than this is deleted
FRESH_S = 60.0  # a queued sign-in older than this is never started: the person has stopped waiting for its code

ASK = {
    ("two_factor", "app"): "Enter the 6-digit code shown on one of your Apple devices.",
    ("two_factor", "sms"): "Enter the 6-digit code Apple texted to your phone.",
}
NOTES = {
    "texts": "Apple would not send a text for this Apple ID. ",
    "wrong": "Apple did not accept that code. ",
}


def now_iso(at: datetime | None = None) -> str:
    return (at or datetime.now(timezone.utc)).isoformat()


class SetupCodes:
    """signin.Codes over the setup row itself: the step shows in the app, which writes the answer back."""

    def __init__(self, db: Supabase, setup_id: str, key: str):
        self.db = db
        self.id = setup_id
        self.key = key

    def _patch(self, patch: dict[str, Any]) -> None:
        self.db.update(TABLE, {"id": f"eq.{self.id}"}, {**patch, "updated_at": now_iso()}, minimal=True)

    def ask(self, step: str, method: str | None, attempt: int, note: str | None = None) -> None:
        detail = NOTES.get(note or "", "") + ASK.get((step, method or ""), "Enter the code Apple sent you.")
        self._patch({"step": step, "method": method, "attempts": attempt, "code": None, "detail": detail})
        log.info("icloud setup code asked", setup=self.id, step=step, method=method, attempt=attempt)

    def take(self) -> str | None:
        row = self.db.first(TABLE, {"select": "code", "id": f"eq.{self.id}"})
        sealed = (row or {}).get("code")
        if not sealed:
            return None
        # Cleared only if it is still what was just read, so one typed in the meantime is not lost.
        self.db.update(TABLE, {"id": f"eq.{self.id}", "code": f"eq.{sealed}"}, {"code": None}, minimal=True)
        try:
            return str(open_json(sealed, self.key))
        except Exception:
            return None

    def waiting(self, detail: str) -> None:
        self._patch({"step": None, "method": None, "code": None, "detail": detail})

    def done(self) -> None:
        self._patch({"step": None, "method": None, "code": None})


class Setups:
    """The setup rows: claiming one, and settling it."""

    def __init__(self, db: Supabase, key: str):
        self.db = db
        self.key = key

    def claim(self, at: datetime | None = None) -> dict[str, Any] | None:
        """The oldest queued setup, now this worker's, or None. One that stopped mid-sign-in is not taken again:
        the person connects again, which queues a new one. Nor is one queued over a minute ago (the worker was
        down), so Apple never prompts a device for a code nobody is waiting to type."""
        fresh = now_iso((at or datetime.now(timezone.utc)) - timedelta(seconds=FRESH_S))
        row = self.db.first(TABLE, {"select": "id,user_id,services,sign_in", "status": "eq.queued", "created_at": f"gt.{fresh}", "order": "created_at"})
        if not row:
            return None
        claimed = self.db.update(TABLE, {"id": f"eq.{row['id']}", "status": "eq.queued"}, {"status": "signing_in", "claimed_at": now_iso(), "detail": "Signing in to your Apple Account.", "updated_at": now_iso()})
        return row if claimed else None

    def sign_in_of(self, row: dict[str, Any]) -> dict[str, Any]:
        return dict(open_json(row["sign_in"], self.key))

    def ready(self, setup_id: str, app_password: str, token: str | None) -> None:
        self.db.update(
            TABLE,
            {"id": f"eq.{setup_id}", "status": "eq.signing_in"},
            {"status": "ready", "result": seal_json({"appPassword": app_password, "trustToken": token}, self.key), "step": None, "method": None, "code": None, "detail": "Connecting Mail and Calendar.", "updated_at": now_iso()},
            minimal=True,
        )

    def failed(self, setup_id: str, detail: str) -> None:
        """Failed, with the reason to show. The sign-in is cleared: nothing typed is kept after a failure."""
        self.db.update(
            TABLE,
            {"id": f"eq.{setup_id}", "status": "in.(queued,signing_in)"},
            {"status": "failed", "error": detail, "sign_in": "", "step": None, "method": None, "code": None, "detail": None, "updated_at": now_iso()},
            minimal=True,
        )

    def sweep(self, at: datetime | None = None) -> None:
        """Ends sign-ins that stopped with the worker, and deletes rows the app never came back for."""
        at = at or datetime.now(timezone.utc)
        stale = now_iso(at - timedelta(seconds=STALE_S))
        rows = self.db.select(TABLE, {"select": "id", "status": "eq.signing_in", "claimed_at": f"lt.{stale}"})
        for row in rows:
            self.failed(row["id"], "The sign-in stopped before it finished. Connect again.")
        self.db.delete(TABLE, {"created_at": f"lt.{now_iso(at - timedelta(seconds=KEEP_S))}"})


MakeApi = Callable[[str, str, str], Any]

# pyicloud's own fixed messages for a refused sign-in (pyicloud/base.py), which say at which step Apple refused it.
STAGES = {
    "Failed to initiate srp authentication.": "init",
    "Invalid email/password combination.": "complete",
    "No password set": "no_password",
    "Not signed in yet": "open",
    "Account page refused the sign-in": "open",
}


def why(err: BaseException) -> dict[str, Any]:
    """Where a sign-in failed, for the log: the step and Apple's HTTP status, never a message from Apple."""
    found: dict[str, Any] = {}
    seen = 0
    current: BaseException | None = err
    while current is not None and seen < 4:
        stage = STAGES.get(str(current.args[0]) if current.args else "")
        if stage and "stage" not in found:
            found["stage"] = stage
        status = getattr(getattr(current, "response", None), "status_code", None) or getattr(current, "code", None)
        if isinstance(status, int) and "status" not in found:
            found["status"] = status
        found.setdefault("error", type(current).__name__)
        current = current.__cause__ or current.__context__
        seen += 1
    return found


def run_setup(setups: Setups, row: dict[str, Any], stop: threading.Event, *, make_api: MakeApi | None = None, site: Callable[[Any], AccountSite] | None = None, **wait: Any) -> str:
    """Signs in, asking for codes in the app, and makes the app-specific password. Returns how it ended
    ("ready", "failed" or "stopped"), having written that to the row."""
    try:
        creds = setups.sign_in_of(row)
        apple_id = str(creds["appleId"])
        password = str(creds["password"])
    except Exception:
        setups.failed(row["id"], "The sign-in could not be read. Connect again.")
        return "failed"
    codes = SetupCodes(setups.db, row["id"], setups.key)
    with SessionDir(apple_id) as folder:
        try:
            api = (make_api or make_account_api)(apple_id, password, folder.path)
            sign_in(api, codes, stop, **wait)
            account = site(api) if site else api.site
            if account is None:
                raise AppPasswordFailed("untrusted")
            codes.waiting("Making an app-specific password for Konva.")
            made = account.make(password)
            setups.ready(row["id"], made, trust_token(api))
            log.info("icloud setup ready", setup=row["id"])
            return "ready"
        except SignInStopped:
            setups.failed(row["id"], "The sign-in was stopped. Connect again.")
            return "stopped"
        except (SignInFailed, AppPasswordFailed) as err:
            setups.failed(row["id"], err.detail)
            log.warn("icloud setup failed", setup=row["id"], code=err.code, **why(err))
            return "failed"
        except Exception as err:
            setups.failed(row["id"], "Apple did not let Konva sign in. Wait a while, then connect again.")
            log.warn("icloud setup failed", setup=row["id"], code=log.code_of(err))
            return "failed"


class SetupRunner:
    """Takes queued setups every few seconds, each on a thread of its own (codes can take minutes)."""

    def __init__(self, setups: Setups, stop: threading.Event):
        self.setups = setups
        self.stop = stop
        self.threads: list[threading.Thread] = []
        self.last_sweep = 0.0

    def tick(self) -> None:
        self.threads = [t for t in self.threads if t.is_alive()]
        if time.monotonic() - self.last_sweep > 300:
            self.last_sweep = time.monotonic()
            self.setups.sweep()
        while (row := self.setups.claim()) is not None:
            thread = threading.Thread(target=run_setup, args=(self.setups, row, self.stop), name=f"icloud-setup-{row['id'][:8]}", daemon=True)
            self.threads.append(thread)
            thread.start()

    def run(self) -> None:
        while not self.stop.is_set():
            try:
                self.tick()
            except SupabaseError as err:
                if missing_relation(err):  # the table is not in the database yet
                    self.stop.wait(600)
                    continue
                log.warn("icloud setup poll failed", code=log.code_of(err))
            except Exception as err:
                log.error("icloud setup poll failed", code=log.code_of(err))
            self.stop.wait(POLL_S)
