import type { Tables } from "@messages/db";
import type { Task } from "./types";

// Tasks and reminders from Microsoft To Do, Google Tasks and iCloud Reminders, as Calendar and the Summary
// show them. The sync worker stores them in public.tasks (title, notes and list name sealed); ticking one
// queues a task_updates row that the worker makes at the provider. Everything here is pure, so it can be
// unit tested: loading is in data.ts and ticking in store.tsx.
//
// An all-day task is stored at midnight UTC of its date, so its day is read as written, like an all-day
// event. An open task due before today is overdue and shows on today, not on the day it was due.

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

/** A local calendar day as "YYYY-MM-DD", as lib/calendar.ts's dayKey. */
function localKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The local day a task is due on, or null when it has no date. */
export function dueDay(task: Pick<Task, "dueAt" | "dueAllDay">): string | null {
  if (!task.dueAt) return null;
  return task.dueAllDay ? task.dueAt.slice(0, 10) : localKey(new Date(task.dueAt));
}

/** Open and due on a day before today. A timed task due earlier today is late, but still today's. */
export function isOverdue(task: Pick<Task, "dueAt" | "dueAllDay" | "completed">, now: Date = new Date()): boolean {
  const day = dueDay(task);
  return !task.completed && !!day && day < localKey(now);
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
  const today = localKey(now);
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
  const today = localKey(now);
  return (tasksByDay(tasks.filter((t) => !t.completed || t.pending), [today], now).get(today) ?? []);
}

/** What a task row says on its right: Saving while a tick is on its way, else Overdue, its time or All Day. */
export function taskWhen(item: DayTask, timeOf: (iso: string) => string): string {
  if (item.task.pending) return "Saving";
  if (item.overdue) return "Overdue";
  return item.timed && item.task.dueAt ? timeOf(item.task.dueAt) : "All Day";
}

/** What a task row says under its title: its list and where it is from, such as "Clients · Google Tasks". */
export function taskDetail(task: Pick<Task, "listName">, source: string | undefined): string {
  return [task.listName, source].filter(Boolean).join(" · ") || "Task";
}
