// Tasks and reminders from Microsoft To Do, Google Tasks and iCloud Reminders, as Calendar and the Summary
// show them. The sync worker stores them in public.tasks (title, notes and list name sealed); ticking one
// queues a task_updates row that the worker makes at the provider. Everything here is pure, so it can be
// unit tested: loading is in data.ts and ticking in store.tsx.
//
// An all-day task is stored at midnight UTC of its date, so its day is read as written, like an all-day
// event. An open task due before today is overdue and shows on today, not on the day it was due.

import type { Tables } from "@messages/db";
import { dayKey, pad } from "./dates";
import type { Task } from "./types";

export const TASK_COLUMNS = "id, account_id, list_name, title, notes, due_at, due_all_day, status, completed_at, priority, contact_id";
export type TaskRowOf = Pick<Tables<"tasks">, "id" | "account_id" | "list_name" | "title" | "notes" | "due_at" | "due_all_day" | "status" | "completed_at" | "priority" | "contact_id">;

/** A tasks row, its sealed text already opened, as the screens use it. */
export function mapTask(row: TaskRowOf): Task {
  return {
    id: row.id,
    accountId: row.account_id,
    title: row.title?.trim() || "Untitled Task",
    notes: row.notes?.trim() || undefined,
    listName: row.list_name?.trim() || undefined,
    dueAt: row.due_at,
    dueAllDay: row.due_all_day,
    completed: row.status === "completed",
    completedAt: row.completed_at ?? undefined,
    priority: row.priority === 1 || row.priority === 2 || row.priority === 3 ? row.priority : undefined,
    contactId: row.contact_id ?? undefined,
  };
}

/** The tasks matching the filter box (already trimmed and lowercased; empty matches all): by title, notes or list name. */
export function visibleTasks<T extends Pick<Task, "title" | "notes" | "listName">>(all: T[], term: string): T[] {
  return term ? all.filter((t) => [t.title, t.notes, t.listName].some((s) => s?.toLowerCase().includes(term))) : all;
}

/** The local day a task is due on, or null when it has no date. */
export function dueDay(task: Pick<Task, "dueAt" | "dueAllDay">): string | null {
  if (!task.dueAt) return null;
  return task.dueAllDay ? task.dueAt.slice(0, 10) : dayKey(new Date(task.dueAt));
}

/** Open and due on a day before today. A timed task due earlier today is late, but still today's. */
export function isOverdue(task: Pick<Task, "dueAt" | "dueAllDay" | "completed">, now: Date = new Date()): boolean {
  const day = dueDay(task);
  return !task.completed && !!day && day < dayKey(now);
}

/** A task as a day shows it: overdue ones sit in the all-day row of today, whatever time they had. */
export interface DayTask {
  task: Task;
  overdue: boolean;
  /** Drawn at its time; false for an all-day or overdue task. */
  timed: boolean;
}

/**
 * The tasks each of these days shows: each on its due day, and open overdue ones on today instead (when today
 * is one of the days). Overdue first, then all-day ones, then by time and title.
 */
export function tasksByDay(tasks: Task[], days: string[], now: Date = new Date()): Map<string, DayTask[]> {
  const today = dayKey(now);
  const shown = new Set(days);
  const map = new Map<string, DayTask[]>();
  for (const task of tasks) {
    const due = dueDay(task);
    if (!due) continue;
    const overdue = isOverdue(task, now);
    const day = overdue ? today : due;
    if (!shown.has(day)) continue;
    const item = { task, overdue, timed: !overdue && !task.dueAllDay };
    const list = map.get(day);
    if (list) list.push(item);
    else map.set(day, [item]);
  }
  for (const list of map.values()) list.sort(byDue);
  return map;
}

function byDue(a: DayTask, b: DayTask) {
  return (
    Number(b.overdue) - Number(a.overdue) ||
    Number(a.timed) - Number(b.timed) ||
    (a.task.dueAt ?? "").localeCompare(b.task.dueAt ?? "") ||
    a.task.title.localeCompare(b.task.title)
  );
}

/** The tasks with no due date still to do (or being saved), matching the filter box, by title: the No Date list. */
export function undatedTasks(all: Task[], term: string): Task[] {
  return visibleTasks(all.filter((t) => !t.dueAt && (!t.completed || t.pending)), term).sort((a, b) => a.title.localeCompare(b.title));
}

/** A tick waiting on the worker: the state it asked for, shown until the row settles. */
export interface PendingTick {
  /** The task_updates row's id, or a temporary one until it is stored. */
  token: string;
  done: boolean;
}

/** The tasks with the ticks still waiting on the worker laid over them. The same array when there are none. */
export function withTicks(tasks: Task[], pending: Record<string, PendingTick | undefined>): Task[] {
  if (!Object.values(pending).some(Boolean)) return tasks;
  return tasks.map((t) => {
    const tick = pending[t.id];
    return tick && tick.done !== t.completed ? { ...t, completed: tick.done, pending: true } : tick ? { ...t, pending: true } : t;
  });
}

/** Today's tasks for the Summary and the brief: open overdue ones first, then open ones due today. */
export function tasksForToday(tasks: Task[], now: Date = new Date()): DayTask[] {
  const today = dayKey(now);
  return (tasksByDay(tasks.filter((t) => !t.completed || t.pending), [today], now).get(today) ?? []);
}

/** What a task row says on its right: Saving while a tick is on its way, else Overdue, its time or All Day. */
export function taskWhen(item: DayTask, timeOf: (iso: string) => string): string {
  if (item.task.pending) return "Saving";
  if (!item.task.dueAt) return "No Date";
  if (item.overdue) return "Overdue";
  return item.timed && item.task.dueAt ? timeOf(item.task.dueAt) : "All Day";
}

/** What a task row says under its title: its list and where it is from, such as "Clients · Google Tasks". */
export function taskDetail(task: Pick<Task, "listName">, source: string | undefined): string {
  return [task.listName, source].filter(Boolean).join(" · ") || "Task";
}

// ---------------------------------------------------------------------------------------------------------
// Making, changing and deleting tasks (20261107130000_task_writes.sql). Each is a task_updates row the worker
// hands to the task's provider, like a tick; title and notes are sealed in the browser before the row is stored.
// ---------------------------------------------------------------------------------------------------------

/** The accounts a task can be made in. */
export const TASK_PROVIDERS = ["microsoft_todo", "google_tasks", "icloud_reminders"] as const;
export const TASK_PROVIDER_NAMES: Record<string, string> = { microsoft_todo: "Microsoft To Do", google_tasks: "Google Tasks", icloud_reminders: "iCloud Reminders" };
/** Google Tasks keeps only a task's date, so there is no time to set and no priority. */
export const dateOnly = (provider: string | undefined) => provider === "google_tasks";

export const MAX_TASK_TITLE = 500;
export const MAX_NOTES = 8000;

/** A task being made or changed, as the form holds it. date is "YYYY-MM-DD" and time "HH:MM", both "" when not set. */
export interface TaskForm {
  title: string;
  notes: string;
  accountId: string;
  date: string;
  time: string;
  /** 0 for none, else 1 high, 2 medium, 3 low. */
  priority: 0 | 1 | 2 | 3;
}

/** What a task_updates row holds for a form, before title and notes are sealed. */
export interface TaskWriteFields {
  title: string;
  notes: string | null;
  due_at: string | null;
  due_all_day: boolean;
  priority: 1 | 2 | 3 | null;
}

/** The form as the day the task is due on and its time, read from a task as the screens hold it (see dueDay). */
export function formOfTask(task: Task): TaskForm {
  const day = dueDay(task) ?? "";
  const at = task.dueAt && !task.dueAllDay ? new Date(task.dueAt) : null;
  return {
    title: task.title === "Untitled Task" ? "" : task.title,
    notes: task.notes ?? "",
    accountId: task.accountId,
    date: day,
    time: at ? `${pad(at.getHours())}:${pad(at.getMinutes())}` : "",
    priority: task.priority ?? 0,
  };
}

/** Why a form cannot be saved, or null. A task may have no date (Calendar lists those under No Date), but a time needs one. */
export function taskProblem(form: TaskForm): { field: "title" | "notes" | "date"; text: string } | null {
  if (!form.title.trim()) return { field: "title", text: "Enter a title." };
  if (form.title.trim().length > MAX_TASK_TITLE) return { field: "title", text: `Keep the title under ${MAX_TASK_TITLE} characters.` };
  if (form.notes.length > MAX_NOTES) return { field: "notes", text: `Keep the notes under ${MAX_NOTES} characters.` };
  if (!form.date && form.time) return { field: "date", text: "Pick a due date for the time, or clear the time." };
  return null;
}

/**
 * The fields to store for a form. A date alone is an all-day task, at midnight UTC of the date; with a time it is
 * that local time. Google Tasks keeps neither a time nor a priority, so they are left out for it.
 */
export function taskWriteFields(form: TaskForm, provider: string | undefined): TaskWriteFields {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(form.date);
  const t = /^(\d{2}):(\d{2})$/.exec(form.time);
  const timed = !!m && !!t && !dateOnly(provider);
  const dueAt = !m ? null : timed ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t![1]), Number(t![2])).toISOString() : `${form.date}T00:00:00Z`;
  return {
    title: form.title.trim(),
    notes: form.notes.trim() || null,
    due_at: dueAt,
    due_all_day: !timed,
    priority: dateOnly(provider) || form.priority === 0 ? null : form.priority,
  };
}

/** The task a form stands for, to show at once while the worker makes it. */
export function taskOfWrite(id: string, accountId: string, write: TaskWriteFields, base?: Task): Task {
  return {
    ...base,
    id,
    accountId,
    title: write.title,
    notes: write.notes ?? undefined,
    dueAt: write.due_at,
    dueAllDay: write.due_all_day,
    completed: base?.completed ?? false,
    priority: write.priority ?? undefined,
    pending: true,
  };
}

/** A task made here and not yet stored has a temporary id: it cannot be ticked, changed or deleted until it is. */
const TEMP = "new-task-";
export const tempTaskId = () => `${TEMP}${crypto.randomUUID()}`;
export const isTempTask = (task: Pick<Task, "id">) => task.id.startsWith(TEMP);

/** True when the form differs from the task it was opened from, so Save has something to save. */
export function taskChanged(form: TaskForm, task: Task): boolean {
  const before = formOfTask(task);
  return (["title", "notes", "date", "time", "priority"] as const).some((k) => (k === "title" || k === "notes" ? form[k].trim() !== before[k].trim() : form[k] !== before[k]));
}

