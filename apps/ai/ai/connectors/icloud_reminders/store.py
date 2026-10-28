"""Everything the iCloud Reminders connector reads and writes in Supabase, through the AI worker's PostgREST
client with the service role, so every query scopes by account or user itself.

The tables the other task connectors use: accounts and account_credentials, sync_state (the CloudKit
zone's sync token), tasks and task_updates (the tasks layer, apps/worker/src/tasks/index.ts), and
instagram_sign_ins for the step a sign-in waits at (see signin). Only IDs, counts and error codes are ever
logged."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from ... import log
from ...analytics import Analytics, event
from ...fields import TASK_LIST, TASK_NOTES, TASK_TITLE
from ...supabase import Supabase, SupabaseError, in_list
from ...vault import Vault
from ..instagram.sealing import AccountSealer, open_json  # "v2:" under the owner's key; open_json reads the web app's short-lived "v1:" codes

PROVIDER = "icloud_reminders"
STATE_SCOPE = "icloud_reminders"
WRITE_ROWS = 200
PAGE = 1000


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, db: Supabase, vault: Vault, *, encryption_key: str):
        self.db = db
        self.vault = vault
        self.encryption_key = encryption_key  # the old static key: reads "v1:" values and the web app's short-lived sign-in codes
        self.creds = AccountSealer(db, vault, encryption_key)  # stored sign-ins and sessions, "v2:" under the owner's key
        self.analytics = Analytics(db)

    # -- accounts ---------------------------------------------------------------------------------------

    def accounts(self) -> list[dict[str, Any]]:
        """Every iCloud Reminders account, with when its sign-in last changed (a new sign-in restarts it)."""
        return self.db.select("accounts", {"select": "id,user_id,status,account_credentials(updated_at)", "provider": f"eq.{PROVIDER}"})

    def credentials(self, account_id: str) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
        """What the app saved (kind, Apple ID, and a password until it has been used) and the saved session."""
        row = self.db.first("account_credentials", {"select": "ciphertext,refreshed", "account_id": f"eq.{account_id}"})
        if not row:
            return None, None
        creds = self.creds.open(account_id, row["ciphertext"]) if self.creds.sealed(row.get("ciphertext")) else None
        session = self.creds.open(account_id, row["refreshed"]) if self.creds.sealed(row.get("refreshed")) else None
        return creds, session

    def kind(self, account_id: str) -> str | None:
        """What kind of sign-in is saved: "web" for this connector's, none for anything else."""
        try:
            creds, _ = self.credentials(account_id)
        except Exception:
            return None
        return str((creds or {}).get("kind") or "") or None

    def save_session(self, account_id: str, apple_id: str, session: dict[str, Any]) -> None:
        """pyicloud's cookies and session data (session.SessionDir.dump), sealed. Writing refreshed does not
        move updated_at, so it never restarts the account."""
        self.db.update("account_credentials", {"account_id": f"eq.{account_id}"}, {"refreshed": self.creds.seal(account_id, {"appleId": apple_id, "session": session})}, minimal=True)

    def forget_password(self, account_id: str, apple_id: str) -> str | None:
        """Once the session is trusted the password is not kept: later runs use the session, and one Apple
        has ended needs the person to sign in again. Returns the sign-in's new updated_at."""
        rows = self.db.update("account_credentials", {"account_id": f"eq.{account_id}"}, {"ciphertext": self.creds.seal(account_id, {"kind": "web", "appleId": apple_id})})
        return rows[0].get("updated_at") if rows else None

    def signed_in(self, account: dict[str, Any]) -> None:
        self.db.update("accounts", {"id": f"eq.{account['id']}"}, {"label": "iCloud Reminders", "status_detail": None}, minimal=True)
        self.emit(account["user_id"], "account_connect", provider=PROVIDER, step="sign_in", outcome="done")

    def set_status(self, account: dict[str, Any], status: str, detail: str | None = None) -> None:
        """Like the sync worker's setAccountStatus, with the same usage events."""
        before = self.db.first("accounts", {"select": "status,created_at,last_synced_at", "id": f"eq.{account['id']}"})
        patch: dict[str, Any] = {"status": status, "status_detail": detail}
        if status == "connected":
            patch["last_synced_at"] = now_iso()
        self.db.update("accounts", {"id": f"eq.{account['id']}"}, patch, minimal=True)
        if not before or before.get("status") == status:
            return
        user = account["user_id"]
        if status == "error":
            self.emit(user, "sync_error", provider=PROVIDER, code="account_error")
            if before.get("status") == "connecting":
                self.emit(user, "account_connect", provider=PROVIDER, step="sync", outcome="failed", code="connect_failed")
        elif status == "connected":
            if before.get("status") == "connecting":
                self.emit(user, "account_connect", provider=PROVIDER, step="sync", outcome="done")
            if not before.get("last_synced_at"):
                started = datetime.fromisoformat(str(before.get("created_at")).replace("Z", "+00:00"))
                self.emit(user, "first_sync_done", provider=PROVIDER, secs=round(max(0.0, (datetime.now(timezone.utc) - started).total_seconds())))

    def set_detail(self, account_id: str, detail: str | None) -> None:
        self.db.update("accounts", {"id": f"eq.{account_id}"}, {"status_detail": detail}, minimal=True)

    def touch(self, account_id: str) -> None:
        try:
            self.db.update("accounts", {"id": f"eq.{account_id}"}, {"last_synced_at": now_iso()}, minimal=True)
        except SupabaseError:
            pass

    def emit(self, user_id: str, name: str, **props: Any) -> None:
        self.analytics.emit(user_id, [event(name, **props)])

    # -- sync state -------------------------------------------------------------------------------------

    def sync_state(self, account_id: str) -> tuple[str | None, str | None]:
        """(the zone's sync token, when the last full read was, as an ISO time). None before the first sync."""
        row = self.db.first("sync_state", {"select": "sync_token,history_id", "account_id": f"eq.{account_id}", "scope": f"eq.{STATE_SCOPE}"})
        return (row or {}).get("sync_token"), (row or {}).get("history_id")

    def save_sync_state(self, account_id: str, token: str, full_at: str | None) -> None:
        self.db.upsert("sync_state", {"account_id": account_id, "scope": STATE_SCOPE, "sync_token": token, "history_id": full_at}, "account_id,scope")

    # -- tasks ------------------------------------------------------------------------------------------

    def upsert_tasks(self, account: dict[str, Any], rows: list[dict[str, Any]]) -> int:
        """Seals and stores reminders as tasks, adding new ones and updating the rest, matched on
        provider_task_id. contact_id is left out, so a contact already matched is kept."""
        user = account["user_id"]
        sealed = [
            {
                **row,
                "user_id": user,
                "account_id": account["id"],
                "title": self.vault.seal(user, TASK_TITLE, row["title"]) or "",
                "notes": self.vault.seal(user, TASK_NOTES, row["notes"]),
                "list_name": self.vault.seal(user, TASK_LIST, row["list_name"]),
            }
            for row in rows
        ]
        for i in range(0, len(sealed), WRITE_ROWS):
            self.db.upsert("tasks", sealed[i : i + WRITE_ROWS], "account_id,provider_task_id")
        return len(sealed)

    def stored_ids(self, account_id: str) -> list[str]:
        """The provider_task_id of every task stored for the account."""
        out: list[str] = []
        while True:
            page = self.db.select("tasks", {"select": "provider_task_id", "account_id": f"eq.{account_id}", "order": "id", "limit": str(PAGE), "offset": str(len(out))})
            out.extend(str(r["provider_task_id"]) for r in page)
            if len(page) < PAGE:
                return out

    def delete_tasks(self, account_id: str, provider_ids: list[str]) -> int:
        for i in range(0, len(provider_ids), WRITE_ROWS):
            self.db.delete("tasks", {"account_id": f"eq.{account_id}", "provider_task_id": in_list(provider_ids[i : i + WRITE_ROWS])})
        return len(provider_ids)

    def delete_list_tasks(self, account_id: str, list_ids: list[str]) -> None:
        if list_ids:
            self.db.delete("tasks", {"account_id": f"eq.{account_id}", "list_id": in_list(list_ids)})

    # -- ticks ------------------------------------------------------------------------------------------

    def claimed_updates(self, account_id: str, user_id: str) -> list[dict[str, Any]]:
        """This account's changes the sync worker has claimed ("updating"), oldest first, so they reach iCloud
        in the order they were made. The worker claims a row before handing it on and waits for it to settle.
        Three reads, merged: a change to one of this account's tasks, a new task for this account (no task
        yet), and a change whose task is gone (task_id nulls when its task row is deleted), which only the
        user is known for."""
        cols = "id,user_id,action,task_id,account_id,title,notes,due_at,due_all_day,priority,created_at"
        base = {"status": "eq.updating", "order": "created_at", "limit": "50"}
        found = self.db.select("task_updates", {**base, "select": f"{cols},tasks!inner(provider_task_id,account_id)", "tasks.account_id": f"eq.{account_id}"})
        found += self.db.select("task_updates", {**base, "select": f"{cols},tasks(provider_task_id,account_id)", "action": "eq.create", "account_id": f"eq.{account_id}"})
        found += self.db.select("task_updates", {**base, "select": cols, "action": "in.(update,delete)", "task_id": "is.null", "user_id": f"eq.{user_id}"})
        seen: set[str] = set()
        rows = [r for r in found if not (r["id"] in seen or seen.add(r["id"]))]
        return sorted(rows, key=lambda r: str(r.get("created_at") or ""))

    def open_task_text(self, row: dict[str, Any]) -> tuple[str, str | None]:
        """(title, notes) of a create or update row in plain text; the app sealed them in the browser."""
        user = row["user_id"]
        title = self.vault.open(user, TASK_TITLE, row.get("title")) or ""
        notes = self.vault.open(user, TASK_NOTES, row.get("notes"))
        return str(title), (str(notes) if notes else None)

    def task_id_of(self, account_id: str, provider_id: str) -> str | None:
        row = self.db.first("tasks", {"select": "id", "account_id": f"eq.{account_id}", "provider_task_id": f"eq.{provider_id}"})
        return (row or {}).get("id")

    def finish_update(self, row: dict[str, Any], error: str | None = None, code: str | None = None, *, task_id: str | None = None) -> None:
        """Settles a claimed change: done, or failed with a reason fit to show in the app. A tick writes its
        task's status and completed_at first, so the app has the new status by the time it hears the row
        settle; a delete removes its task row first; a create names the task it made (task_id). The text
        of an edit was stored by the connector already. A row already settled is left alone."""
        mine = {"id": f"eq.{row['id']}", "status": "eq.updating"}
        if error is not None:
            if self.db.update("task_updates", mine, {"status": "failed", "error": error}):
                self.emit(row["user_id"], "task_update", provider=PROVIDER, action=row["action"], outcome="failed", code=code or "provider_refused")
            return
        patch: dict[str, Any] = {"status": "done", "error": None}
        if row["action"] in ("complete", "reopen"):
            complete = row["action"] == "complete"
            self.db.update(
                "tasks",
                {"id": f"eq.{row['task_id']}", "user_id": f"eq.{row['user_id']}"},
                {"status": "completed" if complete else "open", "completed_at": now_iso() if complete else None},
                minimal=True,
            )
        elif row["action"] == "delete" and row.get("task_id"):
            self.db.delete("tasks", {"id": f"eq.{row['task_id']}", "user_id": f"eq.{row['user_id']}"})
        elif row["action"] == "create" and task_id:
            patch["task_id"] = task_id
        if self.db.update("task_updates", mine, patch):
            self.emit(row["user_id"], "task_update", provider=PROVIDER, action=row["action"], outcome="done")

    def finish_superseded(self, row: dict[str, Any]) -> None:
        """Settles a change done: a later delete of the same task made it pointless, so iCloud is not asked."""
        self.db.update("task_updates", {"id": f"eq.{row['id']}", "status": "eq.updating"}, {"status": "done", "error": None}, minimal=True)


class SignInRow:
    """signin.Codes over public.instagram_sign_ins: the step shows in the app, which writes the answer back."""

    ASK = {
        ("two_factor", "app"): "Enter the 6-digit code shown on one of your Apple devices.",
        ("two_factor", "sms"): "Enter the 6-digit code Apple texted to your phone.",
        ("code", "app"): "Turn on Access iCloud Data on the Web on your iPhone, then continue and approve the prompt on your device.",
    }
    NOTES = {
        "texts": "Apple would not send a text for this Apple ID. ",
        "again": "Apple did not get your approval in time. ",
        "wrong": "Apple did not accept that code. ",
    }

    def __init__(self, store: Store, account: dict[str, Any]):
        self.store = store
        self.account = account

    def ask(self, step: str, method: str | None, attempt: int, note: str | None = None) -> None:
        detail = self.NOTES.get(note or "", "") + self.ASK.get((step, method or ""), "Enter the code Apple sent you.")
        self.store.db.upsert(
            "instagram_sign_ins",
            {"account_id": self.account["id"], "user_id": self.account["user_id"], "step": step, "method": method, "code": None, "attempts": attempt},
            "account_id",
        )
        self.store.set_detail(self.account["id"], detail)
        log.info("icloud reminders code asked", account=self.account["id"], step=step, method=method, attempt=attempt)

    def take(self) -> str | None:
        row = self.store.db.first("instagram_sign_ins", {"select": "code", "account_id": f"eq.{self.account['id']}"})
        sealed = (row or {}).get("code")
        if not sealed:
            return None
        # Cleared only if it is still what was just read, so one typed in the meantime is not lost.
        self.store.db.update("instagram_sign_ins", {"account_id": f"eq.{self.account['id']}", "code": f"eq.{sealed}"}, {"code": None}, minimal=True)
        try:
            return str(open_json(sealed, self.store.encryption_key))
        except Exception:
            return None

    def waiting(self, detail: str) -> None:
        """No step to answer now: the app shows the detail while Konva waits on Apple."""
        self.done()
        self.store.set_detail(self.account["id"], detail)

    def done(self) -> None:
        try:
            self.store.db.delete("instagram_sign_ins", {"account_id": f"eq.{self.account['id']}"})
        except SupabaseError:
            pass
