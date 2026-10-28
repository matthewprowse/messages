import type { AccountRow } from "../db";
import { db, must, recordEvent, retryWrite } from "../db";
import { log } from "../log";
import { open, seal } from "../vault";
import { INTERRUPTED, taskFailureCode, taskRow, taskStatusPatch, taskWriteOf, type TaskInput, type TaskRow, type TaskUpdateRow, type TaskWrite } from "./rows";

export * from "./rows";

// ---------------------------------------------------------------------------------------------------------
// The tasks layer: the contract between the task connectors (Microsoft To Do, Google Tasks, iCloud
// Reminders), the worker and the app. The tables are the source of truth
// (supabase/migrations/20261030100000_connectors_foundation.sql and 20261030180000_task_updates_queue.sql);
// these helpers are one way to keep to them.
//
// public.tasks, written by the connectors only (the app can read, never write):
//   - One row per task, unique on (account_id, provider_task_id). user_id is the account's user.
//   - title, notes and list_name are sealed per user (FIELD.taskTitle, taskNotes, taskList) with the
//     worker's seal(), so they are ciphertext when ENCRYPT_CONTENT is on. title is '' when there is none.
//   - due_at is null for a task with no date. A timed task has its instant and due_all_day false. An
//     all-day task has midnight UTC of its date ("2026-10-30T00:00:00Z") and due_all_day true.
//   - status is 'open' or 'completed'; completed_at is set only on a completed task (null if unknown).
//   - priority is 1 high, 2 medium, 3 low or null. contact_id is the client it is about, when matched.
//   - provider_meta holds whatever the connector needs to change the task later (etags and the like).
//   upsertTasks(account, rows) below seals and stores rows in that shape. A connector that writes its own
//   must keep to it, and removes the rows of tasks deleted at the provider itself.
//
// public.task_updates, a tick (action 'complete') or untick ('reopen') made in the app:
//   - The app inserts it 'queued'. The worker hears it through Realtime, or its poll every 15 seconds.
//   - The worker, not the connector, claims it ('updating'), hands it to the running connector of the
//     task's account as connector.updateTask(row), and settles it ('done' or 'failed' with a short reason
//     the app shows). On done it also writes tasks.status and completed_at, so the app shows the tick
//     before the next sync.
//   - Of several queued ticks for one task only the latest is made; the earlier are settled 'done' without
//     asking the provider (superseded). One tick per task is under way at a time.
//   - A row left 'updating' by a restart is failed (INTERRUPTED), as the provider may have taken it.
//   - Ticks for an account that is in error or disconnected fail with a reconnect reason; ones for an
//     account whose connector has no updateTask fail as not supported; ones for a connector still
//     starting wait for the next pass.
//
// connector.updateTask(row), on the three task connectors:
//   - Loads its task with taskOfUpdate(row) (sealed fields stay sealed: the provider ids are plain),
//     makes row.action at the provider, and resolves once the provider has taken it.
//   - Throws on failure. Throw a TaskUpdateError for a reason fit to show in the app ("This task was
//     deleted in Google Tasks."); anything else shows as "<Provider> could not be reached. Try again."
//   - Does not claim or settle the row: the worker does both. A connector may still call
//     finishTaskUpdate itself (to settle with a note, say); the worker's own finish then does nothing.
//   - Completing a task that is already completed (or reopening an open one) must succeed, not fail.
//
// Creating, editing and deleting tasks in the app (20261107130000_task_writes.sql) use the same queue and the
// same rules, with a handler per action instead of updateTask: connector.createTask(row), editTask(row) and
// deleteTask(row). The row's title and notes are sealed (FIELD.taskTitle, taskNotes): read the wanted state
// with taskWriteOf(row) below.
//   - create has no task yet (task_id is null, account_id says where). Once the provider has the task, the
//     connector stores it in public.tasks as a synced one (upsertTasks, or its own sealed rows), so the app
//     shows it before the next sync.
//   - update carries the whole wanted state; the connector writes it to the provider, clearing what is null,
//     and to the tasks row. delete removes the provider's task (already gone is success) and the tasks row.
//   - Unlike ticks, these are never superseded: each is made, oldest first, one at a time per task.
//   - A connector without the handler fails the row as not supported. The iCloud Reminders connector, for an
//     account signed in on the web, leaves them to the AI worker as it does ticks, and waits for it to settle.
// ---------------------------------------------------------------------------------------------------------

/** Rows stored in one request. */
const UPSERT_BATCH = 200;

/**
 * Seals and stores tasks read from an account's provider, adding new ones and updating the rest, matched on
 * provider_task_id. Rows without contact_id keep the contact already matched. Returns how many were stored.
 */
export async function upsertTasks(account: Pick<AccountRow, "id" | "user_id">, rows: TaskInput[]): Promise<number> {
  const stored = await Promise.all(rows.map((r) => taskRow(account.user_id, account.id, r, seal)));
  // Upserted in two groups, so a batch without contacts never sets the matched ones to null.
  const groups = [stored.filter((r) => r.contact_id !== undefined), stored.filter((r) => r.contact_id === undefined)];
  for (const group of groups) {
    for (let i = 0; i < group.length; i += UPSERT_BATCH) {
      must(await db.from("tasks").upsert(group.slice(i, i + UPSERT_BATCH), { onConflict: "account_id,provider_task_id" }), "store tasks");
    }
  }
  return stored.length;
}

/** The task a tick is for, as stored (title, notes and list name still sealed), or null once it is gone. */
export async function taskOfUpdate(row: TaskUpdateRow): Promise<TaskRow | null> {
  if (!row.task_id) return null;
  return must(await db.from("tasks").select("*").eq("id", row.task_id).eq("user_id", row.user_id).maybeSingle(), "load task to tick");
}

/** The wanted state of a create or update row, its sealed text opened. */
export function taskWriteOfRow(row: TaskUpdateRow): Promise<TaskWrite> {
  return taskWriteOf(row, open);
}

export async function queuedTaskUpdates(): Promise<TaskUpdateRow[]> {
  return must(await db.from("task_updates").select("*").eq("status", "queued").order("created_at").limit(100), "load task updates");
}

/** The queued ticks for one task, oldest first. */
export async function queuedTaskUpdatesFor(taskId: string): Promise<TaskUpdateRow[]> {
  return must(await db.from("task_updates").select("*").eq("task_id", taskId).eq("status", "queued").order("created_at"), "load task's updates");
}

/** One queued row (a create has no task to look its queue up by), as a list: empty once it is no longer queued. */
export async function queuedTaskUpdateById(id: string): Promise<TaskUpdateRow[]> {
  return must(await db.from("task_updates").select("*").eq("id", id).eq("status", "queued"), "load task update");
}

/** Marks a queued tick as under way. Returns false if another run already took it. */
export async function claimTaskUpdate(id: string): Promise<boolean> {
  const rows = must(await db.from("task_updates").update({ status: "updating" }).eq("id", id).eq("status", "queued").select("id"), "claim task update");
  return rows.length === 1;
}

/** Settles ticks a later one replaced, without asking the provider. */
export async function supersedeTaskUpdates(rows: TaskUpdateRow[]) {
  if (rows.length === 0) return;
  must(await db.from("task_updates").update({ status: "done", error: null }).in("id", rows.map((r) => r.id)).eq("status", "queued"), "supersede task updates");
}

/** Fails ticks that cannot be made, queued or under way. */
export async function failTaskUpdates(rows: TaskUpdateRow[], reason: string, provider = "") {
  if (rows.length === 0) return;
  must(await db.from("task_updates").update({ status: "failed", error: reason }).in("id", rows.map((r) => r.id)).in("status", ["queued", "updating"]), "fail task updates");
  for (const row of rows) recordEvent(row.user_id, "task_update", { provider, action: row.action, outcome: "failed", code: taskFailureCode(reason) });
}

/**
 * Settles a tick that is under way: done, with its task's status and completed_at written to match, or
 * failed with the reason given. A row already settled is left alone, so finishing twice is harmless.
 */
export async function finishTaskUpdate(row: TaskUpdateRow, outcome: { error?: string } = {}, provider = "") {
  const current = must(await db.from("task_updates").select("status").eq("id", row.id).maybeSingle(), "load task update");
  if (current?.status !== "updating") return;
  if (outcome.error !== undefined) {
    await failTaskUpdates([row], outcome.error, provider);
    return;
  }
  if (row.action === "complete" || row.action === "reopen") {
    // The task first, so the app has the new status by the time it hears the row settle.
    const written = await retryWrite(() => db.from("tasks").update(taskStatusPatch(row.action as "complete" | "reopen")).eq("id", row.task_id!).eq("user_id", row.user_id));
    if (!written) log.warn("ticked task not stored", { task: row.task_id });
  }
  const saved = await retryWrite(() => db.from("task_updates").update({ status: "done", error: null }).eq("id", row.id).eq("status", "updating"));
  if (!saved) log.warn("task update not settled", { update: row.id });
  recordEvent(row.user_id, "task_update", { provider, action: row.action, outcome: "done" });
}

/** A tick left "updating" by a worker that stopped mid-request may or may not have happened, so it is failed rather than made again. */
export async function failInterruptedTaskUpdates() {
  must(await db.from("task_updates").update({ status: "failed", error: INTERRUPTED }).eq("status", "updating"), "fail interrupted task updates");
}

/** The accounts named, in one read, by id. */
export async function accountsById(ids: string[]): Promise<Map<string, { id: string; provider: string; status: string }>> {
  const out = new Map<string, { id: string; provider: string; status: string }>();
  if (ids.length === 0) return out;
  const rows = must(await db.from("accounts").select("id, provider, status").in("id", ids), "load task accounts");
  for (const r of rows) out.set(r.id, r);
  return out;
}

/** Which of these users have an iCloud Reminders account, whose changes the AI worker's connector may settle itself. */
export async function usersWithReminders(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = must(await db.from("accounts").select("user_id").eq("provider", "icloud_reminders").in("user_id", userIds), "load reminders accounts");
  return new Set(rows.map((r) => r.user_id));
}

/** Each task's account, for the tasks named, in one read. Tasks that are gone are missing from the map. */
export async function accountsOfTasks(taskIds: string[]): Promise<Map<string, { id: string; provider: string; status: string }>> {
  const out = new Map<string, { id: string; provider: string; status: string }>();
  if (taskIds.length === 0) return out;
  const rows = must(await db.from("tasks").select("id, accounts(id, provider, status)").in("id", taskIds), "load task accounts");
  for (const r of rows) if (r.accounts) out.set(r.id, r.accounts);
  return out;
}
