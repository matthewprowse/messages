"""One iCloud Reminders account, in a thread of its own: sign in once (or pick up the saved session), then
read what changed every couple of minutes and apply the changes made in the app (ticks, new tasks, edits, deletes).

Reads use pyicloud's RemindersService (2026.10.1): sync_cursor() and iter_changes(since=token) for the
com.apple.reminders zone's delta (a full read, every few hours and on the first sync after a start, also
removes what is gone), lists() for the lists' names, and get() then update() to tick or edit a reminder, create() to add one and delete() to remove one.
Every iCloud call happens on this thread, one at a time. A sign-in Apple has ended stops the account with
Reconnect in Settings; limits and outages back off."""

from __future__ import annotations

import hashlib
import json
import random
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from ... import log
from .backoff import STOPS, Backoff, kind_of, poll_wait, trouble
from .mapping import apple_due, apple_priority, priority, task_row, wanted_lists
from .session import SessionDir
from .signin import SignInFailed, SignInStopped, open_reminders, sign_in
from .store import PROVIDER, SignInRow, Store

LOOP_S = 3.0  # ticks are looked for this often; it is a database read until there is one
FULL_EVERY = timedelta(hours=6)  # a full read at least this often, which catches anything the changes missed
SESSION_SAVE_S = 600.0
RELOGIN = "Connect iCloud Reminders again in Settings."

REASONS = {
    "gone": "This reminder was deleted in iCloud Reminders.",
    "network": "iCloud Reminders could not be reached. Try again.",
    "attention": "iCloud Reminders needs attention. Reconnect it in Settings, Connected Accounts, then try again.",
    "refused": "iCloud Reminders did not accept this change. Try again.",
    "deleted": "This reminder was deleted in iCloud.",
    "no_list": "iCloud Reminders has no list to add this to. Create a list in Reminders, then try again.",
    "no_title": "A task needs a title.",
}
TICKS = ("complete", "reopen")
CHANGES = ("create", "update", "delete")


class Rejected(Exception):
    """A change that cannot be made as asked; the reason is fit to show in the app."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def update_failure(err: BaseException) -> tuple[str, str]:
    """(the reason shown in the app, a code word for analytics) for a tick that did not go through."""
    if isinstance(err, LookupError):
        return REASONS["gone"], "provider_refused"
    kind = kind_of(err)
    if kind == "network":
        return REASONS["network"], "unreachable"
    if kind in STOPS:
        return REASONS["attention"], "account_needs_attention"
    return REASONS["refused"], "provider_refused"


def print_of(row: dict[str, Any]) -> str:
    """What a stored task was last written as, kept as a hash so the plain text is not held in memory."""
    return hashlib.sha256(json.dumps(row, sort_keys=True, default=str).encode()).hexdigest()


class AccountSync:
    def __init__(
        self,
        store: Store,
        account: dict[str, Any],
        stop: threading.Event,
        *,
        on_credentials: Callable[[str | None], None] = lambda _updated: None,
        make_api: Callable[[str, str | None, str], Any] | None = None,
        rand: Callable[[], float] = random.random,
        clock: Callable[[], float] = time.monotonic,
        now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    ):
        self.store = store
        self.account = account
        self.id = account["id"]
        self.user_id = account["user_id"]
        self.stop = stop
        self.on_credentials = on_credentials
        self._make_api = make_api
        self.rand = rand
        self.clock = clock
        self.now = now
        self.backoff = Backoff(rand)
        self.apple_id = ""
        self.dir: SessionDir | None = None
        self.saved_session = ""
        self.saved_at = 0.0
        self.paused_until = 0.0
        self.connected = False
        self.auth_failures = 0
        self.names: dict[str, str] | None = None  # the lists' names at the last read; None before the first
        self.written: dict[str, str] = {}  # each stored reminder's fingerprint, so a full read rewrites only what changed

    # -- starting ---------------------------------------------------------------------------------------

    def run(self) -> None:
        try:
            ready = self.connect()
            if ready is not None:
                self.loop(*ready)
        except SignInStopped:
            log.info("icloud reminders sign-in stopped", account=self.id)
        except Exception as err:
            log.error("icloud reminders account failed", account=self.id, code=log.code_of(err))
            self.store.set_status(self.account, "error", "iCloud Reminders sync stopped after an error. Connect again in Settings.")
        finally:
            if self.dir:
                self.dir.close()

    def api_for(self, apple_id: str, password: str | None) -> Any:
        assert self.dir
        if self._make_api:
            return self._make_api(apple_id, password, self.dir.path)
        from .client import make_api

        return make_api(apple_id, password, self.dir.path)

    def connect(self) -> tuple[Any, Any] | None:
        """(the signed-in client, its RemindersService): signed in now when the app has just saved a password,
        else the saved session as it is. None when the account stopped instead."""
        creds, saved = self.store.credentials(self.id)
        if not creds or creds.get("kind") != "web" or not creds.get("appleId"):
            self.store.set_status(self.account, "error", RELOGIN)
            return None
        self.apple_id = str(creds["appleId"])
        same = bool(saved) and str(saved.get("appleId", "")).lower() == self.apple_id.lower()
        self.dir = SessionDir(self.apple_id)
        # The saved session is kept for the next sign-in too: its trust token lets Apple skip the code.
        if same and saved:
            self.dir.restore(saved.get("session"))
        password = creds.get("password")
        api = self.api_for(self.apple_id, str(password) if password else None)
        if password:
            return self.sign_in(api)
        if not same:
            self.store.set_status(self.account, "error", RELOGIN)
            return None
        return self.resume(api)

    def sign_in(self, api: Any) -> tuple[Any, Any] | None:
        self.store.set_status(self.account, "connecting", "Signing in to iCloud.")
        codes = SignInRow(self.store, self.account)
        try:
            waiter = sign_in(api, codes, self.stop)
            reminders = open_reminders(api, codes, waiter)
        except SignInFailed as failed:
            log.warn("icloud reminders sign-in failed", account=self.id, code=failed.code)
            self.store.emit(self.user_id, "account_connect", provider=PROVIDER, step="sign_in", outcome="failed", code=failed.code)
            self.store.set_status(self.account, "error", failed.detail)
            return None
        finally:
            codes.done()
        self.save_session(force=True)
        self.on_credentials(self.store.forget_password(self.id, self.apple_id))
        self.store.signed_in(self.account)
        log.info("icloud reminders signed in", account=self.id)
        return api, reminders

    def resume(self, api: Any) -> tuple[Any, Any] | None:
        """Picks up the saved session. Apple has to still accept it: pyicloud cannot sign in again without
        the password, which is not kept, so a session that has ended means the person signs in again."""
        while not self.stop.is_set():
            try:
                api.authenticate()
                if api.requires_2fa or api.requires_2sa or not api.is_trusted_session:
                    raise RuntimeError("session ended")
                return api, api.reminders
            except Exception as err:
                t = STOPS["expired"] if isinstance(err, RuntimeError) else trouble(err)
                log.warn("icloud reminders resume failed", account=self.id, kind=t.kind, code=log.code_of(err))
                if t.stop:
                    self.store.set_status(self.account, "error", t.detail)
                    return None
                self.store.set_detail(self.id, t.detail)
                self.stop.wait(self.backoff.next(t))
        return None

    def save_session(self, force: bool = False) -> None:
        """Keeps pyicloud's cookies and session data when they changed (Apple rotates them), at most every few minutes."""
        saved = self.dir.dump() if self.dir else None
        dumped = json.dumps(saved, sort_keys=True)
        if not saved or dumped == self.saved_session or (not force and self.clock() - self.saved_at < SESSION_SAVE_S):
            return
        self.store.save_session(self.id, self.apple_id, saved)
        self.saved_session = dumped
        self.saved_at = self.clock()

    # -- the loop ---------------------------------------------------------------------------------------

    def loop(self, api: Any, reminders: Any) -> None:
        next_sync = self.clock()
        token, _ = self.store.sync_state(self.id)
        if token is None:
            self.store.set_status(self.account, "syncing", "Importing your reminders.")
        while not self.stop.is_set():
            try:
                if self.clock() >= self.paused_until:
                    self.apply_updates(reminders)
                if self.clock() >= next_sync:
                    self.sync(reminders)
                    if not self.connected:
                        self.store.set_status(self.account, "connected")
                        self.connected = True
                    elif self.backoff.failures:
                        self.store.set_status(self.account, "connected")  # clears the reason it was waiting
                    else:
                        self.store.touch(self.id)
                    self.backoff.reset()
                    self.auth_failures = 0
                    self.save_session()
                    next_sync = self.clock() + poll_wait(self.rand)
            except SignInStopped:
                return
            except Exception as err:
                t = trouble(err)
                if t.kind == "expired" and self.auth_failures == 0:
                    # Apple's web access (the PCS cookies) lapses before the sign-in does: ask for it again once.
                    self.auth_failures += 1
                    try:
                        reminders = api.reminders
                        continue
                    except Exception as again:
                        t = trouble(again)
                log.warn("icloud reminders request failed", account=self.id, kind=t.kind, code=log.code_of(err))
                self.store.emit(self.user_id, "sync_error", provider=PROVIDER, code=t.kind)
                if t.stop:
                    self.save_session(force=True)
                    self.store.set_status(self.account, "error", t.detail)
                    return
                wait = self.backoff.next(t)
                next_sync = self.paused_until = self.clock() + wait
                self.store.set_detail(self.id, t.detail)
                log.info("icloud reminders backing off", account=self.id, kind=t.kind, inS=round(wait))
            self.stop.wait(LOOP_S)

    # -- reading ----------------------------------------------------------------------------------------

    def sync(self, reminders: Any) -> None:
        """Stores what changed since the last sync token, or everything on the first sync after a start, every
        few hours, and when a list was renamed (its name is on each task). A change token Apple no longer
        accepts also falls back to everything."""
        token, full_at = self.store.sync_state(self.id)
        last_full = _parse(full_at)
        full = token is None or self.names is None or last_full is None or self.now() - last_full > FULL_EVERY
        cursor = reminders.sync_cursor()  # taken first, so a change made while reading is read again next time
        names, gone = wanted_lists(list(reminders.lists()))
        if self.names is not None and names != self.names:
            full = True
        try:
            self.store_changes(reminders, None if full else token, full, names, gone)
        except Exception as err:
            if full or kind_of(err) != "other":
                raise
            log.warn("icloud reminders delta failed", account=self.id, code=log.code_of(err))
            full = True
            self.store_changes(reminders, None, True, names, gone)
        self.names = names
        self.store.save_sync_state(self.id, cursor, self.now().isoformat() if full else full_at)

    def store_changes(self, reminders: Any, since: str | None, full: bool, names: dict[str, str], gone: set[str]) -> None:
        now = self.now()
        rows: dict[str, dict[str, Any]] = {}
        removed: set[str] = set()
        for change in reminders.iter_changes(since=since):
            if self.stop.is_set():
                raise SignInStopped()
            reminder = change.reminder
            if change.type == "deleted" or reminder is None or reminder.list_id in gone:
                removed.add(change.reminder_id)
                continue
            row = task_row(reminder, names.get(reminder.list_id), now)
            if row:
                rows[reminder.id] = row
                removed.discard(reminder.id)
            else:  # deleted, or completed too long ago
                removed.add(reminder.id)
                rows.pop(reminder.id, None)
        if full and (rows or names):
            removed.update(set(self.store.stored_ids(self.id)) - set(rows))  # no longer in iCloud: only a full read can say so
        self.store.delete_list_tasks(self.id, sorted(gone))
        changed = {pid: row for pid, row in rows.items() if self.written.get(pid) != print_of(row)}
        if changed:
            self.store.upsert_tasks(self.account, list(changed.values()))
            for pid, row in changed.items():
                self.written[pid] = print_of(row)
        if removed:
            self.store.delete_tasks(self.id, sorted(removed))
            for pid in removed:
                self.written.pop(pid, None)
        if changed or removed:
            log.info("icloud reminders synced", account=self.id, full=full, written=len(changed), removed=len(removed))

    # -- ticks and edits --------------------------------------------------------------------------------

    def mine(self, row: dict[str, Any]) -> bool:
        """Whether this claimed row is this account's to apply: a tick or an edit of one of its tasks, a new
        task for it, or an edit whose task is already gone (no task left to name an account, so only the user)."""
        action = row.get("action")
        if row.get("user_id") != self.user_id or action not in TICKS + CHANGES:
            return False
        if action == "create":
            return row.get("account_id") == self.id
        task = row.get("tasks")
        if task:
            return task.get("account_id") == self.id
        return action in ("update", "delete") and not row.get("task_id")

    def apply_updates(self, reminders: Any) -> None:
        """Ticks, unticks, new tasks, edits and deletes made in the app, one at a time and in order. The sync
        worker has claimed each ("updating") and waits for it to settle; settling is done here, with the reason
        when it did not go through. A delete wins over the edits queued before it for the same task."""
        rows = [row for row in self.store.claimed_updates(self.id, self.user_id) if self.mine(row)]
        last_delete = {row["task_id"]: i for i, row in enumerate(rows) if row["action"] == "delete" and row.get("task_id")}
        for i, row in enumerate(rows):
            if self.stop.is_set():
                return
            action = row["action"]
            if action != "delete" and i < last_delete.get(row.get("task_id"), -1):
                self.store.finish_superseded(row)
                continue
            task = row.get("tasks") or {}
            try:
                if action in TICKS:
                    self.tick(reminders, row, str(task["provider_task_id"]))
                elif action == "create":
                    self.create(reminders, row)
                elif action == "update":
                    self.edit(reminders, row, str(task["provider_task_id"]) if task else None)
                else:
                    self.remove(reminders, row, str(task["provider_task_id"]) if task else None)
            except Rejected as err:
                self.store.finish_update(row, err.reason, "invalid_input")
                log.warn("icloud reminders change refused", account=self.id, update=row["id"], action=action)
            except Exception as err:
                reason, code = update_failure(err)
                if action == "update" and isinstance(err, LookupError):
                    reason = REASONS["deleted"]
                self.store.finish_update(row, reason, code)
                log.warn("icloud reminders tick failed", account=self.id, update=row["id"], code=log.code_of(err))
                if not isinstance(err, LookupError):
                    raise  # the loop decides whether it is a wait or the end of the session

    def tick(self, reminders: Any, row: dict[str, Any], reminder_id: str) -> None:
        """Completes (or reopens) one reminder in iCloud. One already as asked is left as it is and counts as done."""
        reminder = reminders.get(reminder_id)
        if getattr(reminder, "deleted", False):
            raise LookupError(reminder_id)
        want = row["action"] == "complete"
        if bool(reminder.completed) != want:
            reminder.completed = want
            reminder.completed_date = None  # pyicloud stamps it now when completing
            reminders.update(reminder)
        self.store.finish_update(row)
        log.info("icloud reminders tick applied", account=self.id, update=row["id"], action=row["action"])

    def list_names(self, reminders: Any) -> dict[str, str]:
        """The lists' names: as at the last read, or read now before the first."""
        if self.names is not None:
            return self.names
        return wanted_lists(list(reminders.lists()))[0]

    def keep(self, reminders: Any, reminder: Any) -> str | None:
        """Stores a reminder this connector just wrote as a task, like a synced one, so the app has it without
        waiting for the next read. The id of the task row, or None when it is not one to store."""
        names = self.list_names(reminders)
        row = task_row(reminder, names.get(reminder.list_id), self.now())
        if not row:
            return None
        self.store.upsert_tasks(self.account, [row])
        self.written[row["provider_task_id"]] = print_of(row)
        return self.store.task_id_of(self.id, row["provider_task_id"])

    def create(self, reminders: Any, row: dict[str, Any]) -> None:
        """Adds a reminder to the account's default list (the one called Reminders, else the first) and stores it."""
        title, notes = self.store.open_task_text(row)
        if not title.strip():
            raise Rejected(REASONS["no_title"])
        names = self.list_names(reminders)
        if not names:
            raise Rejected(REASONS["no_list"])
        list_id = next((lid for lid, name in names.items() if name.strip().lower() == "reminders"), next(iter(names)))
        due, all_day, zone = apple_due(row.get("due_at"), bool(row.get("due_all_day")))
        created = reminders.create(
            list_id,
            title.strip(),
            desc=notes or "",
            due_date=due,
            priority=apple_priority(row.get("priority")),
            all_day=all_day,
            time_zone=zone,
        )
        task_id = self.keep(reminders, created)
        self.store.finish_update(row, task_id=task_id)
        log.info("icloud reminders task created", account=self.id, update=row["id"])

    def edit(self, reminders: Any, row: dict[str, Any], reminder_id: str | None) -> None:
        """Sets a reminder's title, notes, due date and priority to what the app wants (null clears)."""
        if reminder_id is None:
            raise LookupError("gone")
        reminder = reminders.get(reminder_id)
        if getattr(reminder, "deleted", False):
            raise LookupError(reminder_id)
        title, notes = self.store.open_task_text(row)
        if not title.strip():
            raise Rejected(REASONS["no_title"])
        reminder.title = title.strip()
        reminder.desc = notes or ""
        want = row.get("priority")
        if priority(int(reminder.priority or 0)) != want:  # a priority already in the wanted band is left as Apple has it
            reminder.priority = apple_priority(want)
        reminder.due_date, reminder.all_day, reminder.time_zone = apple_due(row.get("due_at"), bool(row.get("due_all_day")))
        reminders.update(reminder)
        self.keep(reminders, reminder)
        self.store.finish_update(row)
        log.info("icloud reminders task edited", account=self.id, update=row["id"])

    def remove(self, reminders: Any, row: dict[str, Any], reminder_id: str | None) -> None:
        """Deletes a reminder in iCloud, then its task row. One already gone counts as done."""
        if reminder_id is not None:
            try:
                reminder = reminders.get(reminder_id)
                if not getattr(reminder, "deleted", False):
                    reminders.delete(reminder)
            except LookupError:
                pass
            self.written.pop(reminder_id, None)
        self.store.finish_update(row)
        log.info("icloud reminders task deleted", account=self.id, update=row["id"])


def _parse(value: str | None) -> datetime | None:
    try:
        return datetime.fromisoformat((value or "").replace("Z", "+00:00"))
    except ValueError:
        return None
