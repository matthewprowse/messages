// Microsoft To Do through Microsoft Graph: every list and its tasks, for Calendar and the daily brief. Each
// list is read with a delta query, so after the first full read only what changed comes back; the delta link
// is kept per list in sync_state (scope "todo:<list id>", the link in sync_token). Every few minutes the
// lists are read again and each list's changes fetched. Tasks deleted in To Do, and lists that are gone, are
// removed. Ticking a task off, or back on, in the app is applied through task_updates.

import type { Tables, TablesInsert } from "@messages/db";
import { FIELD } from "@messages/crypto/fields";
import { Backoff, Sleeper } from "../backoff";
import { allRows, db, must, saveSyncState, setAccountStatus, type AccountRow } from "../db";
import { errorCode, log } from "../log";
import { chunks, mapLimit } from "../util";
import { seal } from "../vault";
import { NO_TITLE, TASK_GONE, TaskUpdateError, taskOfUpdate, taskWriteOfRow } from "../tasks";
import { GraphApiError, signInRevoked, type GraphClient } from "../microsoft/client";
import { TASKS_SCOPE } from "../microsoft/oauth";
import { microsoftFatalDetail, openGraphClient } from "../microsoft/session";
import { ianaZone } from "../microsoft/windows-zones";
import {
  defaultTodoList,
  graphInstant,
  statusPatch,
  storedTodoTask,
  throttleWait,
  todoUpdateFailure,
  todoWriteBody,
  type GraphTodoList,
  type GraphTodoTask,
} from "../microsoft/todo-task";

const POLL_MS = 3 * 60_000;
const PAGE_SIZE = 100;
const LISTS_AT_ONCE = 2; // lists read together (Graph allows four requests at once per mailbox)
const WRITE_CHUNK = 200;
const SCOPE_PREFIX = "todo:";
/** The list name stored when To Do gives none. */
const UNNAMED_LIST = "Tasks";

interface DeltaPage {
  value?: GraphTodoTask[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
}

export class MicrosoftTodoConnector {
  private stopped = false;
  private readonly sleeper = new Sleeper();
  private readonly backoff = new Backoff();
  /** The signed-in client while a session is running; queued changes wait until there is one. */
  private client: GraphClient | null = null;
  /** Your time zone (IANA), which due dates written in UTC are read in. */
  private userZone = "UTC";
  /** Each list's name as last stored, so a renamed list is written to its tasks once. */
  private readonly listNames = new Map<string, string>();
  /** Changes to tasks run one at a time, so two to the same task cannot cross. */
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
      let wait: number | null = null;
      try {
        await this.session();
      } catch (err) {
        if (this.stopped) break;
        const fatal = microsoftFatalDetail(err, "To Do");
        if (fatal) {
          if (signInRevoked(err)) log.error("microsoft todo sign-in revoked", { account: this.id, code: errorCode(err) });
          await setAccountStatus(this.id, "error", fatal).catch(() => undefined);
          return;
        }
        if (err instanceof GraphApiError && err.status === 429) {
          // Still throttled after the client's own retries: wait as long as Graph asks, keeping what is stored.
          log.warn("microsoft todo throttled", { account: this.id });
          wait = throttleWait(err.retryAfter, this.backoff.next());
        } else {
          log.warn("microsoft todo sync failed", { account: this.id, code: errorCode(err) });
          await setAccountStatus(this.id, "connecting", "Connection lost. Reconnecting.").catch(() => undefined);
        }
      }
      if (this.stopped) break;
      await this.sleeper.wait(wait ?? this.backoff.next());
    }
  }

  private async session() {
    await setAccountStatus(this.id, "connecting");
    const { client } = await openGraphClient(this.id, [TASKS_SCOPE]);
    this.client = client;
    const profile = must(await db.from("profiles").select("timezone").eq("user_id", this.account.user_id).maybeSingle(), "load time zone");
    this.userZone = ianaZone(profile?.timezone) ?? "UTC";

    await setAccountStatus(this.id, "syncing");
    while (!this.stopped) {
      await this.sync(client);
      this.backoff.reset();
      await setAccountStatus(this.id, "connected");
      await this.sleeper.wait(POLL_MS);
    }
  }

  /** Reads every list, removes the ones that are gone, and fetches each remaining list's changes. */
  private async sync(client: GraphClient) {
    const lists: GraphTodoList[] = [];
    let next: string | undefined = "/me/todo/lists";
    let query: Record<string, string> | undefined = { $select: "id,displayName" };
    while (next) {
      const page: { value?: GraphTodoList[]; "@odata.nextLink"?: string } = await client.request(next, { query });
      lists.push(...(page.value ?? []));
      next = page["@odata.nextLink"];
      query = undefined; // a next link carries its own
    }

    // Each list's delta link; a list with a row but no link has had a first read started.
    const states = new Map<string, string | null>();
    const rows = must(await db.from("sync_state").select("scope, sync_token").eq("account_id", this.id).like("scope", `${SCOPE_PREFIX}%`), "load todo sync state");
    for (const row of rows) states.set(row.scope.slice(SCOPE_PREFIX.length), row.sync_token);

    const current = new Set(lists.map((list) => list.id));
    let removed = 0;
    for (const listId of states.keys()) {
      if (current.has(listId)) continue;
      removed += await this.dropList(listId);
    }

    const counts = await mapLimit(lists, LISTS_AT_ONCE, (list) => this.syncList(client, list, states.has(list.id), states.get(list.id) ?? null));
    const written = counts.reduce((sum, c) => sum + c.written, 0);
    removed += counts.reduce((sum, c) => sum + c.removed, 0);
    log.info("microsoft todo synced", { account: this.id, lists: lists.length, written, removed });
  }

  /** A list deleted in To Do: its tasks and its delta link go. */
  private async dropList(listId: string): Promise<number> {
    const gone = must(await db.from("tasks").delete().eq("account_id", this.id).eq("list_id", listId).select("id"), "remove todo list tasks");
    must(await db.from("sync_state").delete().eq("account_id", this.id).eq("scope", SCOPE_PREFIX + listId), "remove todo sync state");
    this.listNames.delete(listId);
    return gone.length;
  }

  /**
   * One list's changes since its delta link, or every task in it when there is none (the first read, or Graph
   * no longer knowing the link). After a full read, stored tasks Graph did not return are removed.
   */
  private async syncList(client: GraphClient, list: GraphTodoList, hasRow: boolean, deltaLink: string | null): Promise<{ written: number; removed: number }> {
    const scope = SCOPE_PREFIX + list.id;
    const name = list.displayName?.trim() || UNNAMED_LIST;
    const ref = { id: list.id, name };
    // Recorded before any task is stored, so a list deleted mid-read still has its tasks removed later.
    if (!hasRow) await saveSyncState(this.id, scope, { sync_token: null });
    if (this.listNames.get(list.id) !== name) {
      const sealed = await seal(this.account.user_id, FIELD.taskList, name);
      must(await db.from("tasks").update({ list_name: sealed }).eq("account_id", this.id).eq("list_id", list.id), "rename todo list");
      this.listNames.set(list.id, name);
    }

    const full = !deltaLink;
    const seen = new Set<string>();
    let written = 0;
    let removed = 0;
    let url: string | undefined = deltaLink ?? `/me/todo/lists/${encodeURIComponent(list.id)}/tasks/delta`;
    let newLink: string | null = null;
    try {
      while (url) {
        const page: DeltaPage = await client.request(url, { prefer: [`odata.maxpagesize=${PAGE_SIZE}`] });
        const changed: TablesInsert<"tasks">[] = [];
        const gone: string[] = [];
        for (const task of page.value ?? []) {
          if (!task.id) continue;
          if (task["@removed"]) {
            gone.push(task.id);
            continue;
          }
          seen.add(task.id);
          changed.push(storedTodoTask(task, { userId: this.account.user_id, accountId: this.id, list: ref, userZone: this.userZone }));
        }
        written += await this.store(changed);
        removed += await this.remove(list.id, gone);
        url = page["@odata.nextLink"];
        if (!url) newLink = page["@odata.deltaLink"] ?? null;
      }
    } catch (err) {
      // 410: Graph no longer knows the delta link, so the list is read again in full.
      if (err instanceof GraphApiError && err.status === 410 && !full) {
        log.info("microsoft todo list read again", { account: this.id });
        await saveSyncState(this.id, scope, { sync_token: null });
        const again = await this.syncList(client, list, true, null);
        return { written: written + again.written, removed: removed + again.removed };
      }
      // 404: the list was deleted since it was listed; the next pass removes it.
      if (err instanceof GraphApiError && err.status === 404) return { written, removed };
      throw err;
    }

    if (full) removed += await this.removeUnseen(list.id, seen);
    await saveSyncState(this.id, scope, { sync_token: newLink });
    return { written, removed };
  }

  /** Stores tasks with their title, notes and list name sealed. */
  private async store(rows: TablesInsert<"tasks">[]): Promise<number> {
    const userId = this.account.user_id;
    for (const batch of chunks(rows, WRITE_CHUNK)) {
      const sealed = await Promise.all(
        batch.map(async (row) => ({
          ...row,
          title: (await seal(userId, FIELD.taskTitle, row.title ?? "")) ?? "",
          notes: await seal(userId, FIELD.taskNotes, row.notes),
          list_name: await seal(userId, FIELD.taskList, row.list_name),
        })),
      );
      must(await db.from("tasks").upsert(sealed, { onConflict: "account_id,provider_task_id" }), "store todo tasks");
    }
    return rows.length;
  }

  /** Removes tasks deleted in To Do. Only from this list: a task moved to another list may keep its ID there. */
  private async remove(listId: string, ids: string[]): Promise<number> {
    let removed = 0;
    for (const batch of chunks(ids, WRITE_CHUNK)) {
      const gone = must(
        await db.from("tasks").delete().eq("account_id", this.id).eq("list_id", listId).in("provider_task_id", batch).select("id"),
        "remove todo tasks",
      );
      removed += gone.length;
    }
    return removed;
  }

  /** After a full read: removes this list's stored tasks that To Do no longer has. */
  private async removeUnseen(listId: string, seen: Set<string>): Promise<number> {
    const stored = await allRows(
      (from, to) => db.from("tasks").select("provider_task_id").eq("account_id", this.id).eq("list_id", listId).order("id").range(from, to),
      "load todo tasks",
    );
    return this.remove(listId, stored.map((row) => row.provider_task_id).filter((id) => !seen.has(id)));
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

  /** Changes a task's title, notes, date or importance, as made in the app. */
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

  private signedIn(): GraphClient {
    if (!this.client || this.stopped) throw new TaskUpdateError("Microsoft To Do is still connecting. Try again in a moment.");
    return this.client;
  }

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
    let list: GraphTodoList | null;
    let created: GraphTodoTask;
    try {
      const lists = await client.request<{ value?: GraphTodoList[] }>("/me/todo/lists", { query: { $select: "id,displayName,wellknownListName" }, timeoutMs: 30_000 });
      list = defaultTodoList(lists.value ?? []);
      if (!list) throw new TaskUpdateError("Microsoft To Do has no list to add this task to.");
      created = await client.request<GraphTodoTask>(`/me/todo/lists/${encodeURIComponent(list.id)}/tasks`, { method: "POST", body: todoWriteBody(write, this.userZone, true), timeoutMs: 30_000 });
    } catch (err) {
      if (err instanceof TaskUpdateError) throw err;
      log.warn("microsoft todo task not created", { account: this.id, update: row.id, code: errorCode(err) });
      throw new TaskUpdateError(todoUpdateFailure(err instanceof GraphApiError ? err.status : null));
    }
    const name = list.displayName?.trim() || UNNAMED_LIST;
    await this.store([storedTodoTask(created, { userId: this.account.user_id, accountId: this.id, list: { id: list.id, name }, userZone: this.userZone })]);
    log.info("microsoft todo task created", { account: this.id, update: row.id });
  }

  private async applyEdit(row: Tables<"task_updates">) {
    const client = this.signedIn();
    const task = await this.ownTask(row);
    const write = await taskWriteOfRow(row);
    if (!write.title) throw new TaskUpdateError(NO_TITLE);
    let updated: GraphTodoTask;
    try {
      updated = await client.request<GraphTodoTask>(`/me/todo/lists/${encodeURIComponent(task.list_id)}/tasks/${encodeURIComponent(task.provider_task_id)}`, {
        method: "PATCH",
        body: todoWriteBody(write, this.userZone, false),
        timeoutMs: 30_000,
      });
    } catch (err) {
      log.warn("microsoft todo task not changed", { account: this.id, update: row.id, code: errorCode(err) });
      throw new TaskUpdateError(todoUpdateFailure(err instanceof GraphApiError ? err.status : null));
    }
    // The date and importance as To Do kept them; the title and notes sealed as the app sent them.
    const kept = storedTodoTask(updated, { userId: this.account.user_id, accountId: this.id, list: { id: task.list_id, name: "" }, userZone: this.userZone });
    const meta = task.provider_meta && typeof task.provider_meta === "object" && !Array.isArray(task.provider_meta) ? task.provider_meta : {};
    must(
      await db
        .from("tasks")
        .update({
          title: row.title ?? "",
          notes: row.notes,
          due_at: kept.due_at ?? null,
          due_all_day: kept.due_all_day ?? true,
          priority: kept.priority ?? null,
          provider_meta: { ...meta, etag: updated["@odata.etag"] ?? meta.etag ?? null },
        })
        .eq("id", task.id),
      "store task change",
    );
    log.info("microsoft todo task edited", { account: this.id, update: row.id });
  }

  private async applyDelete(row: Tables<"task_updates">) {
    const client = this.signedIn();
    const task = await this.ownTask(row);
    try {
      await client.request(`/me/todo/lists/${encodeURIComponent(task.list_id)}/tasks/${encodeURIComponent(task.provider_task_id)}`, { method: "DELETE", timeoutMs: 30_000 });
    } catch (err) {
      // Already gone in To Do is what was asked for.
      if (!(err instanceof GraphApiError && err.status === 404)) {
        log.warn("microsoft todo task not deleted", { account: this.id, update: row.id, code: errorCode(err) });
        throw new TaskUpdateError(todoUpdateFailure(err instanceof GraphApiError ? err.status : null));
      }
    }
    must(await db.from("tasks").delete().eq("id", task.id), "remove deleted task");
    log.info("microsoft todo task deleted", { account: this.id, update: row.id });
  }

  /**
   * Sets the task's status in To Do with a PATCH, then keeps its new etag. The worker claims and settles the
   * update (apps/worker/src/tasks): this resolves once To Do has made the change, and throws when it cannot.
   */
  private async applyUpdate(row: Tables<"task_updates">) {
    const client = this.client;
    if (!client || this.stopped) throw new TaskUpdateError("Microsoft To Do is still connecting. Try again in a moment.");
    const task = await taskOfUpdate(row);
    if (!task) throw new TaskUpdateError(todoUpdateFailure(404));
    if (task.account_id !== this.id || row.user_id !== this.account.user_id) throw new TaskUpdateError("This task belongs to another account.");
    const body = statusPatch(row.action);
    if (!body) throw new TaskUpdateError("This change is not one Microsoft To Do can make.");

    let updated: GraphTodoTask | undefined;
    try {
      updated = await client.request<GraphTodoTask>(
        `/me/todo/lists/${encodeURIComponent(task.list_id)}/tasks/${encodeURIComponent(task.provider_task_id)}`,
        { method: "PATCH", body, timeoutMs: 30_000 },
      );
    } catch (err) {
      log.warn("microsoft todo task not changed", { account: this.id, update: row.id, code: errorCode(err) });
      throw new TaskUpdateError(todoUpdateFailure(err instanceof GraphApiError ? err.status : null));
    }

    const completed = body.status === "completed";
    const meta = task.provider_meta && typeof task.provider_meta === "object" && !Array.isArray(task.provider_meta) ? task.provider_meta : {};
    must(
      await db
        .from("tasks")
        .update({
          status: completed ? "completed" : "open",
          completed_at: completed ? (graphInstant(updated?.completedDateTime)?.toISOString() ?? new Date().toISOString()) : null,
          provider_meta: { ...meta, etag: updated?.["@odata.etag"] ?? meta.etag ?? null },
        })
        .eq("id", task.id),
      "store task change",
    );
    log.info("microsoft todo task changed", { account: this.id, update: row.id, action: row.action });
  }
}
