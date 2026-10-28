import { GoogleApiError, type GoogleClient } from "./client";
import { GoogleAuthError } from "./oauth";
import type { TaskWrite } from "../tasks/rows";

// The Google Tasks API, with plain HTTPS calls through GoogleClient: task lists, the tasks in each, and
// what a task becomes when it is stored. Kept apart from the connector so the mapping can be tested
// on hand-written responses.

export const API = "https://tasks.googleapis.com/tasks/v1";
/** The most tasks one tasks.list page returns. */
const TASKS_PER_PAGE = 100;
/** The most task lists one tasklists.list page returns. */
const LISTS_PER_PAGE = 1000;

export interface GoogleTaskList {
  id: string;
  title?: string;
  /** When the list itself last changed, RFC 3339. */
  updated?: string;
}

export interface GoogleTask {
  id: string;
  title?: string;
  notes?: string;
  status?: "needsAction" | "completed";
  /** The day it is due, as midnight of that day. Google keeps only the date. */
  due?: string;
  completed?: string;
  updated?: string;
  /** The task this is a subtask of. Absent for a top-level task. */
  parent?: string;
  /** Its order among its siblings, compared as text. */
  position?: string;
  deleted?: boolean;
  /** Completed and then cleared from the list in Google Tasks. */
  hidden?: boolean;
}

type Page<T> = { items?: T[]; nextPageToken?: string };

/** Every task list on the account, each page of them. */
export async function allTaskLists(client: Pick<GoogleClient, "request">): Promise<GoogleTaskList[]> {
  const lists: GoogleTaskList[] = [];
  let pageToken: string | undefined;
  do {
    const page = await client.request<Page<GoogleTaskList>>(`${API}/users/@me/lists`, { query: { maxResults: LISTS_PER_PAGE, pageToken } });
    lists.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return lists;
}

/**
 * Every task in a list, or only those changed since `updatedMin`. Completed, cleared and deleted tasks come
 * too: completed ones are shown as done, and deleted ones tell the sync what to remove.
 */
export async function listTasks(client: Pick<GoogleClient, "request">, listId: string, updatedMin?: string): Promise<GoogleTask[]> {
  const tasks: GoogleTask[] = [];
  let pageToken: string | undefined;
  do {
    const page = await client.request<Page<GoogleTask>>(`${API}/lists/${encodeURIComponent(listId)}/tasks`, {
      query: { showCompleted: true, showHidden: true, showDeleted: true, maxResults: TASKS_PER_PAGE, updatedMin, pageToken },
    });
    tasks.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return tasks;
}

/**
 * When a task is due, as stored: midnight UTC of its due day, or null for a task with no date. Google keeps
 * only the date and drops any time it is given, so a Google task is always due all day.
 */
export function dueAt(due: string | undefined): string | null {
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(due ?? "")?.[1];
  return day ? `${day}T00:00:00.000Z` : null;
}

/** A task's own fields as stored, before its title, notes and list name are sealed. */
export interface TaskFields {
  provider_task_id: string;
  title: string;
  notes: string | null;
  due_at: string | null;
  due_all_day: true;
  status: "open" | "completed";
  completed_at: string | null;
  /** parent and position keep subtasks under their task, in Google's order. updated skips unchanged tasks. */
  provider_meta: { parent: string | null; position: string | null; updated: string | null; hidden: boolean };
}

export function taskFields(task: GoogleTask): TaskFields {
  const completed = task.status === "completed";
  return {
    provider_task_id: task.id,
    title: task.title ?? "",
    notes: task.notes || null,
    due_at: dueAt(task.due),
    due_all_day: true,
    status: completed ? "completed" : "open",
    completed_at: completed ? (task.completed ?? null) : null,
    provider_meta: { parent: task.parent ?? null, position: task.position ?? null, updated: task.updated ?? null, hidden: !!task.hidden },
  };
}

/** Splits a page of changes into tasks to store and the ids of deleted ones to remove. */
export function sortChanges(tasks: GoogleTask[]): { keep: GoogleTask[]; removed: string[] } {
  const keep: GoogleTask[] = [];
  const removed: string[] = [];
  for (const task of tasks) {
    if (task.deleted) removed.push(task.id);
    else keep.push(task);
  }
  return { keep, removed };
}

/** What tasks.patch is sent to tick a task off or back on. Reopening clears when it was completed. */
export function patchBody(action: string): { status: "completed" } | { status: "needsAction"; completed: null } | null {
  if (action === "complete") return { status: "completed" };
  if (action === "reopen") return { status: "needsAction", completed: null };
  return null;
}

/**
 * The body that makes or changes a task from what the app asked for. Google keeps only the date, so a time is
 * dropped and the day sent as midnight UTC. A create leaves out what is empty; a change sends null for it, which
 * clears it. Google Tasks has no priority.
 */
export function writeBody(write: TaskWrite, create: boolean): { title: string; notes?: string | null; due?: string | null } {
  const due = write.dueAt ? `${write.dueAt.slice(0, 10)}T00:00:00.000Z` : null;
  const body: { title: string; notes?: string | null; due?: string | null } = { title: write.title };
  if (write.notes !== null || !create) body.notes = write.notes;
  if (due !== null || !create) body.due = due;
  return body;
}

/** Google's reasons for "too many requests" sent as a 403, as GoogleClient retries them. */
const RATE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "RESOURCE_EXHAUSTED"]);

/** True when Google turned a request away for going too fast, even after GoogleClient's own retries. */
export function rateLimited(err: unknown): boolean {
  return err instanceof GoogleApiError && (err.status === 429 || (err.status === 403 && err.reason !== null && RATE_REASONS.has(err.reason)));
}

/** True when the Tasks API is not turned on for the Google Cloud project the sign-in belongs to. */
export function apiNotEnabled(err: unknown): boolean {
  return err instanceof GoogleApiError && err.status === 403 && (err.reason === "accessNotConfigured" || err.reason === "SERVICE_DISABLED");
}

export const TASKS_API_OFF = "Turn on the Google Tasks API for your Google Cloud project. Tasks then sync within 15 minutes.";
export const TASK_GONE = "This task is no longer in Google Tasks.";

/** What a failed tick or untick means, in words. */
export function taskUpdateFailure(err: unknown): string {
  if (err instanceof GoogleAuthError) return "Google sign-in expired or was removed. Reconnect Google in Settings, Connected Accounts.";
  if (!(err instanceof GoogleApiError)) return "Google Tasks could not be reached. Try again.";
  if (err.status === 404 || err.status === 410) return TASK_GONE;
  if (rateLimited(err)) return "Google Tasks is busy. Try again in a minute.";
  if (apiNotEnabled(err)) return TASKS_API_OFF;
  if (err.status === 403 && err.reason === "insufficientPermissions") {
    return "Tasks access was not granted. Reconnect Google in Settings, Connected Accounts, and tick the Tasks box.";
  }
  if (err.status === 403) return "You cannot change this task.";
  return "Google Tasks did not change this task. Try again.";
}
