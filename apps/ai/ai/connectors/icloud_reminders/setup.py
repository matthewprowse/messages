"""One iCloud sign-in for Mail, Calendar and Reminders: the job behind Connect iCloud in the app.

The app queues a row in public.icloud_setups with the Apple ID and password (sealed "v2:" under the person's own key,
bound to this table, column and row: sealing.seal_handoff) and what the person ticked. When Mail or Calendar is ticked, this signs in to the account
page (account_site), asks for the code in the app exactly as Reminders does (signin.sign_in, with the step
written to the setup row), makes an app-specific password labelled "Konva", and hands it back sealed with the
sign-in's trust token. The app then checks the password with iCloud Mail and Calendar and saves them as it saves
a pasted one, and starts Reminders with the trust token so Apple may not ask for a second code. The session
here is thrown away as soon as the password is made: nothing that reaches the whole Apple Account is kept for
Mail and Calendar.

  status queued → signing_in → ready (the app takes it) or failed (error is the plain reason)

Rows are the app's to delete once used. The Apple ID password is kept only while it is needed: dropped from the row as
soon as the password is made unless Reminders still needs it, and from any row after WIPE_S; a ready row the app never
took ends after WIPE_S with its made password, a finished one is deleted after FINISHED_S, and any row after KEEP_S.
Only IDs and failure codes are logged.

A row queued by the web app before per-user handoffs holds "v1:" values under the old static ENCRYPTION_KEY. Those are
still read while it is set, and what this writes back to such a row is "v1:" too, so a web app from before the release
can still read it: deploy this worker first, then the web app. Rows live under KEEP_S, so an hour after both are out no
"v1:" handoff is left and ENCRYPTION_KEY can go."""

from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from urllib.parse import urlsplit

from ... import log
from ...supabase import Supabase, SupabaseError, missing_relation
from ...vault import Vault
from ..instagram.sealing import open_handoff, open_legacy, seal_handoff, seal_json
from .account_site import AppPasswordFailed, AccountSite, make_account_api, trust_token
from .session import SessionDir
from .signin import SignInFailed, SignInStopped, sign_in

TABLE = "icloud_setups"
POLL_S = 3.0
STALE_S = 30 * 60.0  # a sign-in claimed this long ago and never finished has stopped (the worker restarted)
KEEP_S = 60 * 60.0  # any row older than this is deleted
WIPE_S = 10 * 60.0  # no row keeps an Apple ID password, a typed code or a made password longer than this
FINISHED_S = 5 * 60.0  # a done or failed row is deleted this long after it ended
SWEEP_S = 60.0  # so WIPE_S is kept to within a minute
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

    def __init__(self, db: Supabase, setup_id: str, key: str, vault: Vault | None = None, user_id: str | None = None):
        self.db = db
        self.id = setup_id
        self.key = key
        self.vault = vault
        self.user_id = user_id

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
            if self.vault is None or self.user_id is None:
                return str(open_legacy(sealed, self.key))
            return str(open_handoff(self.vault, self.key, self.user_id, TABLE, "code", self.id, sealed))
        except Exception:
            return None

    def waiting(self, detail: str) -> None:
        self._patch({"step": None, "method": None, "code": None, "detail": detail})

    def done(self) -> None:
        self._patch({"step": None, "method": None, "code": None})


class Setups:
    """The setup rows: claiming one, and settling it."""

    def __init__(self, db: Supabase, key: str, vault: Vault | None = None):
        self.db = db
        self.key = key  # the old static key, for rows queued before per-user handoffs; empty once retired
        self.vault = vault  # the owners' keys for "v2:" handoffs

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
        sealed = str(row.get("sign_in") or "")
        if sealed.startswith("v1:") or self.vault is None:
            return dict(open_legacy(sealed, self.key))
        return dict(open_handoff(self.vault, self.key, row["user_id"], TABLE, "sign_in", row["id"], sealed))

    def codes_for(self, row: dict[str, Any]) -> SetupCodes:
        """The code exchange of a claimed row."""
        return SetupCodes(self.db, row["id"], self.key, self.vault, row.get("user_id"))

    def _seal(self, row: dict[str, Any], column: str, value: Any) -> str:
        # The format of the sign-in it answers: a row the web app sealed "v1:" (from before per-user handoffs) is read by
        # that same older web app, which only reads "v1:".
        if str(row.get("sign_in") or "").startswith("v1:") or self.vault is None:
            return seal_json(value, self.key)
        return seal_handoff(self.vault, row["user_id"], TABLE, column, row["id"], value)

    def ready(self, row: dict[str, Any], app_password: str, token: str | None, creds: dict[str, Any] | None = None) -> None:
        """Hands the made password to the app. The Apple ID password goes from the row now unless Reminders was ticked,
        which the app still starts with it; the app reads only the addresses for Mail and Calendar."""
        patch: dict[str, Any] = {"status": "ready", "result": self._seal(row, "result", {"appPassword": app_password, "trustToken": token}), "step": None, "method": None, "code": None, "detail": "Connecting Mail and Calendar.", "updated_at": now_iso()}
        if creds is not None and "reminders" not in (row.get("services") or []):
            patch["sign_in"] = self._seal(row, "sign_in", {**creds, "password": ""})
        self.db.update(TABLE, {"id": f"eq.{row['id']}", "status": "eq.signing_in"}, patch, minimal=True)

    def failed(self, setup_id: str, detail: str) -> None:
        """Failed, with the reason to show. The sign-in is cleared: nothing typed is kept after a failure."""
        self.db.update(
            TABLE,
            {"id": f"eq.{setup_id}", "status": "in.(queued,signing_in)"},
            {"status": "failed", "error": detail, "sign_in": "", "step": None, "method": None, "code": None, "detail": None, "updated_at": now_iso()},
            minimal=True,
        )

    def sweep(self, at: datetime | None = None) -> None:
        """Ends sign-ins that stopped with the worker, takes passwords and codes off rows older than WIPE_S, and
        deletes finished rows and rows the app never came back for."""
        at = at or datetime.now(timezone.utc)
        stale = now_iso(at - timedelta(seconds=STALE_S))
        rows = self.db.select(TABLE, {"select": "id", "status": "eq.signing_in", "claimed_at": f"lt.{stale}"})
        for row in rows:
            self.failed(row["id"], "The sign-in stopped before it finished. Connect again.")
        wipe = now_iso(at - timedelta(seconds=WIPE_S))
        self.db.update(
            TABLE, {"status": "eq.ready", "updated_at": f"lt.{wipe}"},
            {"status": "failed", "error": "The sign-in waited too long to finish. Connect again.", "sign_in": "", "result": None, "code": None, "detail": None, "updated_at": now_iso(at)},
            minimal=True,
        )
        # A sign-in still running read the password when it was claimed; its code is left alone, as one typed a moment ago is taken within seconds.
        self.db.update(TABLE, {"created_at": f"lt.{wipe}", "sign_in": "neq."}, {"sign_in": ""}, minimal=True)
        self.db.update(TABLE, {"created_at": f"lt.{wipe}", "status": "neq.signing_in", "code": "not.is.null"}, {"code": None}, minimal=True)
        self.db.delete(TABLE, {"status": "in.(done,failed)", "updated_at": f"lt.{now_iso(at - timedelta(seconds=FINISHED_S))}"})
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
    """Where a sign-in failed, for the log: the step, Apple's HTTP status, the innermost error and the host it was
    talking to. Never a message from Apple, a URL path or anything about the person."""
    found: dict[str, Any] = {}
    seen = 0
    current: BaseException | None = err
    while current is not None and seen < 8:
        stage = STAGES.get(str(current.args[0]) if current.args else "")
        if stage and "stage" not in found:
            found["stage"] = stage
        status = getattr(getattr(current, "response", None), "status_code", None) or getattr(current, "status", None) or getattr(current, "code", None)
        if isinstance(status, int) and "status" not in found:
            found["status"] = status
        url = getattr(getattr(current, "request", None), "url", None)
        if isinstance(url, str) and "host" not in found:
            host = urlsplit(url).hostname
            if host:
                found["host"] = host
        found.setdefault("error", type(current).__name__)
        if current is not err:
            found["cause"] = type(current).__name__
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
    codes = setups.codes_for(row)
    api: Any = None
    with SessionDir(apple_id) as folder:
        try:
            api = (make_api or make_account_api)(apple_id, password, folder.path)
            sign_in(api, codes, stop, **wait)
            account = site(api) if site else api.site
            if account is None:
                raise AppPasswordFailed("untrusted")
            codes.waiting("Making an app-specific password for Konva.")
            made = account.make(password)
            setups.ready(row, made, trust_token(api), creds)
            log.info("icloud setup ready", setup=row["id"])
            return "ready"
        except SignInStopped:
            setups.failed(row["id"], "The sign-in was stopped. Connect again.")
            return "stopped"
        except (SignInFailed, AppPasswordFailed) as err:
            # sign_in takes any refused login for the password. When the account page refused the session after
            # the password and code were accepted, that is what the person is told and the log records.
            refused = getattr(api, "refused", None) if isinstance(err, SignInFailed) else None
            failure = refused or err
            setups.failed(row["id"], failure.detail)
            log.warn("icloud setup failed", setup=row["id"], code=failure.code, **why(failure), **({"stage": "open"} if refused else {}))
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
        if time.monotonic() - self.last_sweep > SWEEP_S:
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
