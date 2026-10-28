import type { TablesInsert } from "@messages/db";
import { htmlToText } from "@messages/email-text";
import { localDate } from "../calendar/create-event";
import { zonedToUtc } from "../caldav/ical";
import type { TaskWrite } from "../tasks/rows";
import { ianaZone } from "./windows-zones";

// Turns a Microsoft To Do task from Graph into a tasks row. Pure, so it can be unit tested; the connector
// seals the title, notes and list name before storing the row.
//
// Dates. To Do keeps a due date as a day, but Graph hands it out as a date and time with a zone: midnight
// of that day in the zone it names ("2026-11-03T00:00:00" in "South Africa Standard Time"), or that midnight
// written in UTC ("2026-11-02T22:00:00" in "UTC" is 3 November in South Africa). A time at midnight in its own
// zone is that day; any other time is the day whose midnight it is nearest to in your time zone. A reminder
// set for the due day is when the task is due, so it shows at that time rather than all day.

/** Graph's dateTimeTimeZone: a wall-clock time and the zone it is in, Windows ("South Africa Standard Time") or IANA. */
export interface GraphDateTimeZone {
  dateTime?: string | null;
  timeZone?: string | null;
}

export interface GraphTodoTask {
  id: string;
  "@odata.etag"?: string;
  /** Set on a task deleted (or moved away) since the last delta round. */
  "@removed"?: { reason?: string };
  title?: string | null;
  body?: { content?: string | null; contentType?: string | null } | null;
  /** low, normal or high. */
  importance?: string | null;
  /** notStarted, inProgress, completed, waitingOnOthers or deferred. */
  status?: string | null;
  isReminderOn?: boolean | null;
  dueDateTime?: GraphDateTimeZone | null;
  reminderDateTime?: GraphDateTimeZone | null;
  completedDateTime?: GraphDateTimeZone | null;
  lastModifiedDateTime?: string | null;
}

export interface GraphTodoList {
  id: string;
  displayName?: string | null;
  /** "defaultList" for the list To Do puts new tasks in, "flaggedEmails" for the flagged emails list, else "none". */
  wellknownListName?: string | null;
}

/** The list a new task goes in: To Do's default list, else the first. Null when there are no lists. */
export function defaultTodoList<T extends GraphTodoList>(lists: T[]): T | null {
  return lists.find((l) => l.wellknownListName === "defaultList") ?? lists[0] ?? null;
}

/** To Do's importance as tasks.priority: high is 1, low is 3. Normal is every task's default, so it is no priority. */
const PRIORITY: Record<string, number> = { high: 1, low: 3 };

interface Wall {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

/** "2026-11-02T22:00:00.0000000" as its parts, or null when it is not a date and time. */
function parseWall(dateTime: string | null | undefined): Wall | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(dateTime?.trim() ?? "");
  if (!m) return null;
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), h: Number(m[4] ?? 0), mi: Number(m[5] ?? 0), s: Number(m[6] ?? 0) };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The instant a Graph date and time is. An unknown zone is read as UTC, which is what Graph sends unless asked otherwise. */
export function graphInstant(value: GraphDateTimeZone | null | undefined): Date | null {
  const wall = parseWall(value?.dateTime);
  if (!wall) return null;
  const zone = ianaZone(value?.timeZone) ?? "UTC";
  const ms = zonedToUtc(wall.y, wall.mo, wall.d, wall.h, wall.mi, wall.s, zone) ?? Date.UTC(wall.y, wall.mo - 1, wall.d, wall.h, wall.mi, wall.s);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/** The day a due date is, YYYY-MM-DD, read as the header explains. `userZone` is an IANA zone. */
export function dueDay(value: GraphDateTimeZone | null | undefined, userZone: string): string | null {
  const wall = parseWall(value?.dateTime);
  if (!wall) return null;
  if (wall.h === 0 && wall.mi === 0 && wall.s === 0) return `${wall.y}-${pad(wall.mo)}-${pad(wall.d)}`;
  const at = graphInstant(value);
  if (!at) return null;
  // Half a day on, the nearest midnight's day is the calendar day: 23:00 rounds up, 01:00 stays.
  return localDate(new Date(at.getTime() + 12 * 3_600_000), userZone).date;
}

/** When a task is due: a time when its reminder is on the due day, the day at midnight UTC otherwise, or nothing. */
export function taskDue(task: Pick<GraphTodoTask, "dueDateTime" | "reminderDateTime" | "isReminderOn">, userZone: string): { due_at: string | null; due_all_day: boolean } {
  const day = dueDay(task.dueDateTime, userZone);
  if (!day) return { due_at: null, due_all_day: true };
  if (task.isReminderOn !== false) {
    const reminder = graphInstant(task.reminderDateTime);
    if (reminder && localDate(reminder, userZone).date === day) return { due_at: reminder.toISOString(), due_all_day: false };
  }
  return { due_at: `${day}T00:00:00Z`, due_all_day: true };
}

/** A task's notes as plain text, or null when it has none. To Do bodies are usually text; Outlook's can be HTML. */
export function taskNotes(body: GraphTodoTask["body"]): string | null {
  const content = body?.content ?? "";
  const text = body?.contentType?.toLowerCase() === "html" ? htmlToText(content) : content.replace(/\r\n?/g, "\n").trim();
  return text || null;
}

/** The tasks row for a To Do task, unsealed. `userZone` is the IANA zone due dates are read in. */
export function storedTodoTask(
  task: GraphTodoTask,
  ctx: { userId: string; accountId: string; list: { id: string; name: string }; userZone: string },
): TablesInsert<"tasks"> {
  const completed = task.status === "completed";
  const completedAt = completed ? (graphInstant(task.completedDateTime)?.toISOString() ?? task.lastModifiedDateTime ?? null) : null;
  return {
    user_id: ctx.userId,
    account_id: ctx.accountId,
    provider_task_id: task.id,
    list_id: ctx.list.id,
    list_name: ctx.list.name,
    title: task.title?.trim() ?? "",
    notes: taskNotes(task.body),
    ...taskDue(task, ctx.userZone),
    status: completed ? "completed" : "open",
    completed_at: completedAt,
    priority: PRIORITY[task.importance?.toLowerCase() ?? ""] ?? null,
    provider_meta: { list_id: ctx.list.id, etag: task["@odata.etag"] ?? null },
  };
}

/** The PATCH body that ticks a task off in To Do, or puts it back. */
export function statusPatch(action: string): { status: "completed" | "notStarted" } | null {
  if (action === "complete") return { status: "completed" };
  if (action === "reopen") return { status: "notStarted" };
  return null;
}

/** What to tell you when To Do turned a change away, by HTTP status (null when it was not reached). */
export function todoUpdateFailure(status: number | null): string {
  if (status === 404) return "This task is no longer in Microsoft To Do.";
  if (status === 400) return "Microsoft To Do did not accept this task. Check its title and date, then try again.";
  if (status === 403) return "Microsoft To Do did not allow this change. Run pnpm connect:microsoft and accept every permission.";
  return "Microsoft To Do could not be reached. Try again.";
}

/** The longest a throttled sync waits before trying again. */
const MAX_THROTTLE_MS = 15 * 60_000;

/**
 * How long to wait after Graph kept throttling past the client's own retries: its Retry-After (seconds or a
 * date) when longer than the usual backoff, capped at 15 minutes.
 */
export function throttleWait(retryAfter: string | null | undefined, backoffMs: number, now = Date.now()): number {
  let ms = 0;
  if (retryAfter) {
    const seconds = Number(retryAfter);
    ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - now;
    if (!Number.isFinite(ms)) ms = 0;
  }
  return Math.min(MAX_THROTTLE_MS, Math.max(backoffMs, ms));
}

/** Graph's importance for a priority: 1 is high, 3 is low, and 2 or none is normal (To Do has no medium). */
export function importanceOf(priority: TaskWrite["priority"]): "high" | "normal" | "low" {
  return priority === 1 ? "high" : priority === 3 ? "low" : "normal";
}

/** A date and time as the wall clock of a zone shows it, "2026-11-03T09:30:00.0000000". */
export function wallClock(instant: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}.0000000`;
}

export interface TodoWriteBody {
  title: string;
  importance: "high" | "normal" | "low";
  body: { content: string; contentType: "text" };
  dueDateTime?: GraphDateTimeZone | null;
  reminderDateTime?: GraphDateTimeZone | null;
  isReminderOn?: boolean;
}

/**
 * The body that makes or changes a To Do task from what the app asked for. A due day is midnight of that day in
 * your zone, which the reader above takes as the day. A task with a time also gets a reminder at that time on
 * the day, which is how the time is kept. A create leaves out what is empty; a change clears it (null), so the
 * task does not keep a date or notes it was given before.
 */
export function todoWriteBody(write: TaskWrite, userZone: string, create: boolean): TodoWriteBody {
  const body: TodoWriteBody = {
    title: write.title,
    importance: importanceOf(write.priority),
    body: { content: write.notes ?? "", contentType: "text" },
  };
  if (!write.dueAt) {
    if (!create) Object.assign(body, { dueDateTime: null, reminderDateTime: null, isReminderOn: false });
    return body;
  }
  if (write.dueAllDay) {
    body.dueDateTime = { dateTime: `${write.dueAt.slice(0, 10)}T00:00:00.0000000`, timeZone: userZone };
    if (!create) Object.assign(body, { reminderDateTime: null, isReminderOn: false });
    return body;
  }
  const at = new Date(write.dueAt);
  const wall = wallClock(at, userZone);
  body.dueDateTime = { dateTime: `${wall.slice(0, 10)}T00:00:00.0000000`, timeZone: userZone };
  body.reminderDateTime = { dateTime: wall, timeZone: userZone };
  body.isReminderOn = true;
  return body;
}
