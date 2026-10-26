import type { Tables, TablesInsert, TablesUpdate } from "@messages/db";
import { FIELD, type Field } from "@messages/crypto/fields";

// The parts of the tasks layer that need no database or network, so they can be unit tested: building the
// sealed rows a connector stores, what a settled tick writes to its task, which queued ticks to make, and
// the reasons shown in the app. See index.ts for the contract they serve.

export type TaskRow = Tables<"tasks">;
export type TaskUpdateRow = Tables<"task_updates">;
export type TaskAction = "complete" | "reopen";

/** The accounts whose tasks are stored in public.tasks, with the name the app shows for each. */
export const TASK_PROVIDERS: Record<string, string> = {
  microsoft_todo: "Microsoft To Do",
  google_tasks: "Google Tasks",
  icloud_reminders: "iCloud Reminders",
};

export const INTERRUPTED = "Ticking this task was interrupted. Reload to check whether it changed.";
export const NOT_A_TASK_ACCOUNT = "Tasks can only be ticked in Microsoft To Do, Google Tasks or iCloud Reminders.";

/**
 * A task as a connector read it from the provider: the tasks columns it owns, in plain text. user_id and
 * account_id come from the account. Leave contact_id out to keep the contact already matched.
 */
export type TaskInput = Omit<TablesInsert<"tasks">, "id" | "user_id" | "account_id" | "created_at" | "updated_at">;

/** Seals one value for a user, as the worker's vault.seal does: ciphertext when ENCRYPT_CONTENT is on. */
export type Sealer = (userId: string, field: Field, value: string | null | undefined) => Promise<string | null>;

const DATE = /^\d{4}-\d{2}-\d{2}/;

function isoOrNull(value: string): string | null {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * The row stored for a task: title, notes and list name sealed, an all-day due date as midnight UTC of the
 * date as written ("2026-10-30", or any time that starts with it), and completed_at only on a completed task.
 */
export async function taskRow(userId: string, accountId: string, input: TaskInput, seal: Sealer): Promise<TablesInsert<"tasks">> {
  const completed = input.status === "completed";
  const allDay = input.due_all_day ?? true;
  const dueAt = !input.due_at ? null : allDay && DATE.test(input.due_at) ? `${input.due_at.slice(0, 10)}T00:00:00Z` : isoOrNull(input.due_at);
  const priority = input.priority === 1 || input.priority === 2 || input.priority === 3 ? input.priority : null;
  const [title, notes, listName] = await Promise.all([
    seal(userId, FIELD.taskTitle, (input.title ?? "").trim()),
    seal(userId, FIELD.taskNotes, input.notes?.trim() || null),
    seal(userId, FIELD.taskList, input.list_name?.trim() || null),
  ]);
  const row: TablesInsert<"tasks"> = {
    user_id: userId,
    account_id: accountId,
    provider_task_id: input.provider_task_id,
    list_id: input.list_id,
    list_name: listName,
    title: title ?? "",
    notes,
    due_at: dueAt,
    due_all_day: allDay,
    status: completed ? "completed" : "open",
    completed_at: completed ? (input.completed_at ?? null) : null,
    priority,
    provider_meta: input.provider_meta ?? {},
  };
  if (input.contact_id !== undefined) row.contact_id = input.contact_id;
  return row;
}

/** What a tick that the provider has taken writes to its task, so the app shows it before the next sync. */
export function taskStatusPatch(action: TaskAction, at: Date = new Date()): Pick<TablesUpdate<"tasks">, "status" | "completed_at"> {
  return action === "complete" ? { status: "completed", completed_at: at.toISOString() } : { status: "open", completed_at: null };
}

export function isTaskAction(action: string): action is TaskAction {
  return action === "complete" || action === "reopen";
}

/**
 * Which queued ticks to make: for each task only its latest, as ticking a task off and on again quickly
 * should leave it as it was last left, without asking the provider twice. The rest are superseded.
 * Rows that are not queued are left out.
 */
export function planTaskUpdates(rows: TaskUpdateRow[]): { apply: TaskUpdateRow[]; superseded: TaskUpdateRow[] } {
  const latest = new Map<string, TaskUpdateRow>();
  const superseded: TaskUpdateRow[] = [];
  const queued = rows.filter((r) => r.status === "queued").sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  for (const row of queued) {
    const before = latest.get(row.task_id);
    if (before) superseded.push(before);
    latest.set(row.task_id, row);
  }
  return { apply: [...latest.values()], superseded };
}

/** Why an account cannot take a tick, or null when it can. */
export function taskAccountProblem(account: { provider: string; status: string }): string | null {
  const name = TASK_PROVIDERS[account.provider];
  if (!name) return NOT_A_TASK_ACCOUNT;
  if (account.status === "error" || account.status === "disconnected") return `${name} needs attention. Reconnect it in Settings, Connected Accounts, then try again.`;
  return null;
}

/** A failure whose message is fit to show in the app, as the reason a tick did not go through. */
export class TaskUpdateError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "TaskUpdateError";
  }
}

/** The reason shown for a tick that failed: a TaskUpdateError's own, else a plain one that names the provider. */
export function taskFailure(err: unknown, provider: string): string {
  if (err instanceof TaskUpdateError && err.message) return err.message;
  return `${TASK_PROVIDERS[provider] ?? "The task list"} could not be reached. Try again.`;
}

/** The reason as a short code word for the analytics. The words themselves are never recorded. */
export function taskFailureCode(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes("interrupted")) return "interrupted";
  if (r.includes("needs attention")) return "account_needs_attention";
  if (r.includes("can only be ticked") || r.includes("cannot be ticked")) return "not_supported";
  if (r.includes("could not be reached")) return "unreachable";
  return "provider_refused";
}
