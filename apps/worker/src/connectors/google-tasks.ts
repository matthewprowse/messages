// Google Tasks: every task list and its tasks, for Calendar and the daily brief. Every few minutes each
// list is asked only for what changed since it was last read (updatedMin), which also reports deleted
// tasks so they can be removed. Each list is read in full now and then as well, which catches anything
// the changes missed. It also ticks tasks off, or back on, as queued in task_updates from the app.

import type { Tables, TablesInsert } from "@messages/db";
import { FIELD } from "@messages/crypto/fields";
import { Backoff, Sleeper } from "../backoff";
import { allRows, db, must, saveSyncState, setAccountStatus, type AccountRow } from "../db";
import { errorCode, log } from "../log";
import { chunks } from "../util";
import { seal } from "../vault";
import { NO_TITLE, TaskUpdateError, taskOfUpdate, taskWriteOfRow } from "../tasks";
import { GoogleApiError, signInRevoked, type GoogleClient } from "../google/client";
import { TASKS_SCOPE } from "../google/oauth";
import { googleFatalDetail, openGoogleClient } from "../google/session";
import {
  API,
  TASKS_API_OFF,
  TASK_GONE,
  allTaskLists,
  apiNotEnabled,
  listTasks,
  patchBody,
  rateLimited,
  sortChanges,
  taskFields,
  taskUpdateFailure,
  writeBody,
  type GoogleTask,
  type GoogleTaskList,
} from "../google/tasks";

const POLL_MS = 3 * 60_000;
/** A list is read in full at least this often, and on the first sync after the worker starts. */
const FULL_EVERY_MS = 6 * 60 * 60_000;
/** Changes are asked for from a little before the last read, so a clock that runs slightly fast misses nothing. */
const OVERLAP_MS = 60_000;
/** How soon to look again when the Tasks API is turned off for the Google Cloud project. */
const API_OFF_RETRY_MS = 15 * 60_000;
/** sync_state scope for a list: when it was last read (sync_token) and when the list itself last changed (history_id). */
const SCOPE = "tasklist:";

/** A list id as a quoted value in a PostgREST in-list. */
const quoted = (value: string) => `"${value.replace(/["\\]/g, "\\$&")}"`;

export class GoogleTasksConnector {
  private stopped = false;
  private readonly sleeper = new Sleeper();
  private readonly backoff = new Backoff();
  /** Waits while Google keeps limiting requests, after GoogleClient's own retries: 1 minute, doubling to 30. */
  private readonly rateBackoff = new Backoff(60_000, 30 * 60_000);
  /** The signed-in client while a session is running; queued updates wait until there is one. */
  private client: GoogleClient | null = null;
  /** When each list was last read in full, and its name then. Kept across sessions, so only a restart reads all again. */
  private readonly lists = new Map<string, { fullAt: number; title: string }>();
  /** Ticks run one at a time, so a quick tick and untick of one task reach Google in order. */
  private updates: Promise<void> = Promise.resolve();

  constructor(private readonly account: AccountRow) {}

  get id() {
    return this.account.id;
  }

  start() {
    void this.run();
  }

  async stop() {
    this.stopped = true;
    this.sleeper.interrupt();
  }

  private async run() {
    while (!this.stopped) {
      let wait: number;
      try {
        await this.session();
        wait = this.backoff.next();
      } catch (err) {
        if (this.stopped) break;
        const fatal = googleFatalDetail(err, "Tasks");
        if (fatal) {
          if (signInRevoked(err)) log.error("tasks sign-in revoked", { account: this.id, code: errorCode(err) });
          await setAccountStatus(this.id, "error", fatal).catch(() => undefined);
          return;
        }
        if (apiNotEnabled(err)) {
          log.warn("tasks api not enabled", { account: this.id });
          await setAccountStatus(this.id, "error", TASKS_API_OFF).catch(() => undefined);
          wait = API_OFF_RETRY_MS;
        } else if (rateLimited(err)) {
          log.warn("tasks rate limited", { account: this.id, code: errorCode(err) });
          await setAccountStatus(this.id, "connecting", "Google Tasks is busy. Trying again shortly.").catch(() => undefined);
          wait = this.rateBackoff.next();
        } else {
          log.warn("tasks sync failed", { account: this.id, code: errorCode(err) });
          await setAccountStatus(this.id, "connecting", "Connection lost. Reconnecting.").catch(() => undefined);
          wait = this.backoff.next();
        }
      }
      if (this.stopped) break;
      await this.sleeper.wait(wait);
    }
  }

  private async session() {
    await setAccountStatus(this.id, "connecting");
    const { client } = await openGoogleClient(this.id, TASKS_SCOPE);
    this.client = client;

    await setAccountStatus(this.id, "syncing");
    while (!this.stopped) {
      await this.sync(client);
      this.backoff.reset();
      this.rateBackoff.reset();
      await setAccountStatus(this.id, "connected");
      await this.sleeper.wait(POLL_MS);
    }
  }

  /** Reads every list's changes, then removes the tasks of lists deleted in Google Tasks. */
  private async sync(client: GoogleClient) {
    const lists = await allTaskLists(client);
    const states = must(
      await db.from("sync_state").select("scope, sync_token, history_id").eq("account_id", this.id).like("scope", `${SCOPE}%`),
      "load task sync state",
    );
    const stateOf = new Map(states.map((s) => [s.scope.slice(SCOPE.length), s]));

    let written = 0;
    let removed = 0;
    for (const list of lists) {
      if (this.stopped) return;
      const result = await this.syncList(client, list, stateOf.get(list.id));
      written += result.written;
      removed += result.removed;
    }

    // Every account has at least its default list, so an empty answer is never taken as "all deleted".
    if (lists.length > 0) {
      const ids = new Set(lists.map((l) => l.id));
      must(
        await db.from("tasks").delete().eq("account_id", this.id).not("list_id", "in", `(${[...ids].map(quoted).join(",")})`),
        "remove deleted lists",
      );
      const gone = states.filter((s) => !ids.has(s.scope.slice(SCOPE.length))).map((s) => s.scope);
      if (gone.length) must(await db.from("sync_state").delete().eq("account_id", this.id).in("scope", gone), "forget deleted lists");
      for (const id of this.lists.keys()) if (!ids.has(id)) this.lists.delete(id);
    }
    log.info("tasks synced", { account: this.id, lists: lists.length, written, removed });
  }

  /**
   * One list: only its changes since the last read, or all of it when due a full read. A full read writes only
   * tasks Google changed since they were stored, and removes stored tasks Google no longer has.
   */
  private async syncList(client: GoogleClient, list: GoogleTaskList, state: { sync_token: string | null; history_id: string | null } | undefined) {
    const startedAt = Date.now();
    const title = list.title ?? "";
    const known = this.lists.get(list.id);
    const full = !state?.sync_token || !known || startedAt - known.fullAt >= FULL_EVERY_MS;
    const since = full ? undefined : new Date(Date.parse(state.sync_token!) - OVERLAP_MS).toISOString();

    const { keep, removed: deleted } = sortChanges(await listTasks(client, list.id, since));
    const listName = await seal(this.account.user_id, FIELD.taskList, title);

    let changed: GoogleTask[] = keep;
    let stale: string[] = deleted;
    if (full) {
      const stored = await allRows<{ provider_task_id: string; provider_meta: unknown }>(
        (from, to) => db.from("tasks").select("provider_task_id, provider_meta").eq("account_id", this.id).eq("list_id", list.id).order("id").range(from, to),
        "load stored tasks",
      );
      const updatedOf = new Map(stored.map((t) => [t.provider_task_id, (t.provider_meta as { updated?: string | null } | null)?.updated ?? null]));
      const live = new Set(keep.map((t) => t.id));
      changed = keep.filter((t) => !updatedOf.has(t.id) || updatedOf.get(t.id) !== (t.updated ?? null));
      stale = stored.map((t) => t.provider_task_id).filter((id) => !live.has(id));
    }

    // A renamed list: its stored tasks take the new name. Seen against the name last read, or after a restart
    // against when Google says the list last changed.
    const renamed = known ? known.title !== title : !!state && state.history_id !== (list.updated ?? null);
    if (renamed) must(await db.from("tasks").update({ list_name: listName }).eq("account_id", this.id).eq("list_id", list.id), "rename task list");

    const rows = await Promise.all(changed.map((task) => this.row(list.id, listName, task)));
    for (const batch of chunks(rows, 500)) must(await db.from("tasks").upsert(batch, { onConflict: "account_id,provider_task_id" }), "save tasks");
    // Only from this list: a task moved to another list keeps its id there.
    for (const batch of chunks(stale, 200)) {
      must(await db.from("tasks").delete().eq("account_id", this.id).eq("list_id", list.id).in("provider_task_id", batch), "remove deleted tasks");
    }

    await saveSyncState(this.id, `${SCOPE}${list.id}`, { sync_token: new Date(startedAt).toISOString(), history_id: list.updated ?? null });
    this.lists.set(list.id, { fullAt: full ? startedAt : known!.fullAt, title });
    return { written: rows.length, removed: stale.length };
  }

  /** A task as stored, its title, notes and list name sealed. */
  private async row(listId: string, listName: string | null, task: GoogleTask): Promise<TablesInsert<"tasks">> {
    const fields = taskFields(task);
    const userId = this.account.user_id;
    return {
      ...fields,
      user_id: userId,
      account_id: this.id,
      list_id: listId,
      list_name: listName,
      title: (await seal(userId, FIELD.taskTitle, fields.title)) ?? "",
      notes: await seal(userId, FIELD.taskNotes, fields.notes),
    };
  }

  /** Ticks a task off, or back on, as queued in task_updates. One at a time, in the order they arrive. */
  updateTask(row: Tables<"task_updates">): Promise<void> {
    const run = this.updates.then(() => this.applyUpdate(row));
    this.updates = run.catch(() => undefined);
    return run;
  }

  /** Adds a task made in the app to the default list, then stores it so the app shows it before the next sync. */
  createTask(row: Tables<"task_updates">): Promise<void> {
    return this.queue(() => this.applyCreate(row));
  }

  /** Changes a task's title, notes or date, as made in the app. */
  editTask(row: Tables<"task_updates">): Promise<void> {
    return this.queue(() => this.applyEdit(row));
  }

  /** Deletes a task, as made in the app. */
  deleteTask(row: Tables<"task_updates">): Promise<void> {
    return this.queue(() => this.applyDelete(row));
  }

  private queue(work: () => Promise<void>): Promise<void> {
    const run = this.updates.then(work);
    this.updates = run.catch(() => undefined);
    return run;
  }

  private signedIn(): GoogleClient {
    if (!this.client || this.stopped) throw new TaskUpdateError("Google Tasks is still connecting. Try again in a moment.");
    return this.client;
  }

  /** The task a change is for, which must be this account's. */
  private async ownTask(row: Tables<"task_updates">) {
    const task = await taskOfUpdate(row);
    if (!task) throw new TaskUpdateError(TASK_GONE);
    if (task.account_id !== this.id || row.user_id !== this.account.user_id) throw new TaskUpdateError("This task belongs to another account.");
    return task;
  }

  private async applyCreate(row: Tables<"task_updates">) {
    const client = this.signedIn();
    if (row.account_id !== this.id || row.user_id !== this.account.user_id) throw new TaskUpdateError("This task belongs to another account.");
    const write = await taskWriteOfRow(row);
    if (!write.title) throw new TaskUpdateError(NO_TITLE);
    let created: GoogleTask;
    let list: GoogleTaskList;
    try {
      // The default list by its real id: a stored task's list_id must be one the sync lists, or it removes the task.
      list = await client.request<GoogleTaskList>(`${API}/users/@me/lists/@default`, { timeoutMs: 30_000 });
      created = await client.request<GoogleTask>(`${API}/lists/${encodeURIComponent(list.id)}/tasks`, { method: "POST", body: writeBody(write, true), timeoutMs: 30_000 });
    } catch (err) {
      log.warn("task not created", { account: this.id, update: row.id, code: errorCode(err) });
      throw new TaskUpdateError(taskUpdateFailure(err));
    }
    const listName = await seal(this.account.user_id, FIELD.taskList, list.title ?? "");
    must(await db.from("tasks").upsert(await this.row(list.id, listName, created), { onConflict: "account_id,provider_task_id" }), "store new task");
    log.info("task created", { account: this.id, update: row.id });
  }

  private async applyEdit(row: Tables<"task_updates">) {
    const client = this.signedIn();
    const task = await this.ownTask(row);
    const write = await taskWriteOfRow(row);
    if (!write.title) throw new TaskUpdateError(NO_TITLE);
    let updated: GoogleTask;
    try {
      updated = await client.request<GoogleTask>(`${API}/lists/${encodeURIComponent(task.list_id)}/tasks/${encodeURIComponent(task.provider_task_id)}`, {
        method: "PATCH",
        body: writeBody(write, false),
        timeoutMs: 30_000,
      });
    } catch (err) {
      log.warn("task not changed", { account: this.id, update: row.id, code: errorCode(err) });
      throw new TaskUpdateError(taskUpdateFailure(err));
    }
    const fields = taskFields(updated);
    const meta = task.provider_meta && typeof task.provider_meta === "object" && !Array.isArray(task.provider_meta) ? task.provider_meta : {};
    // Sealed title and notes as the app sent them; the date as Google kept it.
    must(
      await db.from("tasks").update({ title: row.title ?? "", notes: row.notes, due_at: fields.due_at, due_all_day: true, provider_meta: { ...meta, updated: updated.updated ?? null } }).eq("id", task.id),
      "store task change",
    );
    log.info("task edited", { account: this.id, update: row.id });
  }

  private async applyDelete(row: Tables<"task_updates">) {
    const client = this.signedIn();
    const task = await this.ownTask(row);
    try {
      await client.request(`${API}/lists/${encodeURIComponent(task.list_id)}/tasks/${encodeURIComponent(task.provider_task_id)}`, { method: "DELETE", timeoutMs: 30_000 });
    } catch (err) {
      // Already gone in Google Tasks is what was asked for.
      if (!(err instanceof GoogleApiError && (err.status === 404 || err.status === 410))) {
        log.warn("task not deleted", { account: this.id, update: row.id, code: errorCode(err) });
        throw new TaskUpdateError(taskUpdateFailure(err));
      }
    }
    must(await db.from("tasks").delete().eq("id", task.id), "remove deleted task");
    log.info("task deleted", { account: this.id, update: row.id });
  }

  /**
   * Sets the task's status in Google Tasks with tasks.patch. The worker claims and settles the update
   * (apps/worker/src/tasks): this resolves once Google has made the change, and throws when it cannot.
   */
  private async applyUpdate(row: Tables<"task_updates">) {
    const client = this.client;
    if (!client || this.stopped) throw new TaskUpdateError("Google Tasks is still connecting. Try again in a moment.");
    const body = patchBody(row.action);
    if (!body) throw new TaskUpdateError("Google Tasks cannot make this change.");
    const task = await taskOfUpdate(row);
    if (!task || task.account_id !== this.id || row.user_id !== this.account.user_id) throw new TaskUpdateError("This task belongs to another account.");

    try {
      await client.request<GoogleTask>(`${API}/lists/${encodeURIComponent(task.list_id)}/tasks/${encodeURIComponent(task.provider_task_id)}`, {
        method: "PATCH",
        body,
        timeoutMs: 30_000,
      });
    } catch (err) {
      log.warn("task not changed", { account: this.id, update: row.id, code: errorCode(err) });
      throw new TaskUpdateError(taskUpdateFailure(err));
    }
    log.info("task changed", { account: this.id, update: row.id, action: row.action });
  }
}
