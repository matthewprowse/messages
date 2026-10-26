import { zonedToUtc } from "../caldav/ical";

// What Konva Relay (apps/mac-relay) sends and is sent, checked and turned into tasks rows. Pure, so it can be
// unit tested. Upgraded iCloud Reminders lists are not on CalDAV since iOS 13, so the relay reads them on the
// user's Mac through EventKit and posts them here as JSON. Version 1:
//
//   POST /v1/reminders/sync      { version, access, timeZone, lists: [{ id, name }], reminders: [Reminder] }
//   GET  /v1/reminders/updates   { updates: [{ id, reminderId, action }] }, held up to ?wait= seconds
//   POST /v1/reminders/updates/<id>  { ok: true } or { ok: false, error: <code> }
//
// Every request carries Authorization: Bearer <relay token>. Nothing in a payload says whose it is: the token
// alone decides the account, so a relay can only ever write to its own user's tasks.

export const PROTOCOL_VERSION = 1;

/** Caps on one sync, well above a real Reminders library, so a broken or hostile relay cannot flood the table. */
export const MAX_LISTS = 500;
export const MAX_REMINDERS = 20_000;
const MAX_ID = 512;
const MAX_TITLE = 1000;
const MAX_NOTES = 20_000;
const MAX_LIST_NAME = 200;

/** A reminder's due date as EventKit has it: a day, and on that day a time, in a zone or floating. */
export interface RelayDue {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM or HH:MM:SS. Absent for a reminder due on a day with no time. */
  time?: string;
  /** The zone the time is in, such as Africa/Johannesburg. Absent for a floating time. */
  timeZone?: string;
}

export interface RelayReminder {
  /** EventKit's calendarItemExternalIdentifier, which iCloud keeps the same on every device, else its local id. */
  id: string;
  listId: string;
  title: string;
  notes: string | null;
  due: RelayDue | null;
  completed: boolean;
  completedAt: string | null;
  /** EventKit's priority: 0 none, 1 to 4 high, 5 medium, 6 to 9 low (iCalendar's PRIORITY). */
  priority: number;
}

export interface RelaySync {
  /** "denied" when the Mac has not allowed the relay to read Reminders: nothing is changed then. */
  access: "full" | "denied";
  /** The Mac's own zone, for a time with none. */
  timeZone: string | null;
  lists: Map<string, string>;
  reminders: RelayReminder[];
}

/** The task row a reminder becomes, before its text is sealed. */
export interface TaskFields {
  provider_task_id: string;
  list_id: string;
  list_name: string | null;
  title: string;
  notes: string | null;
  due_at: string | null;
  due_all_day: boolean;
  status: "open" | "completed";
  completed_at: string | null;
  priority: 1 | 2 | 3 | null;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number): string | null => (typeof v === "string" ? v.slice(0, max) : null);
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** A zone this runtime knows, else null. */
function knownZone(zone: unknown): string | null {
  if (typeof zone !== "string" || zone.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

function parseDue(v: unknown): RelayDue | null {
  if (!isObject(v) || typeof v.date !== "string" || !DATE.test(v.date)) return null;
  const due: RelayDue = { date: v.date };
  if (typeof v.time === "string" && TIME.test(v.time)) due.time = v.time;
  const zone = knownZone(v.timeZone);
  if (zone) due.timeZone = zone;
  return due;
}

function parseReminder(v: unknown): RelayReminder | null {
  if (!isObject(v)) return null;
  const id = typeof v.id === "string" && v.id.length > 0 && v.id.length <= MAX_ID ? v.id : null;
  const listId = typeof v.listId === "string" && v.listId.length > 0 && v.listId.length <= MAX_ID ? v.listId : null;
  if (!id || !listId) return null;
  const completedAt = typeof v.completedAt === "string" && !Number.isNaN(Date.parse(v.completedAt)) ? new Date(v.completedAt).toISOString() : null;
  return {
    id,
    listId,
    title: text(v.title, MAX_TITLE) ?? "",
    notes: text(v.notes, MAX_NOTES),
    due: parseDue(v.due),
    completed: v.completed === true,
    completedAt,
    priority: typeof v.priority === "number" && Number.isInteger(v.priority) ? v.priority : 0,
  };
}

/** Checks a sync from the relay. Reminders that do not make sense are left out rather than failing the rest. */
export function parseSync(body: unknown): Parsed<RelaySync> {
  if (!isObject(body)) return { ok: false, error: "bad_body" };
  if (body.version !== PROTOCOL_VERSION) return { ok: false, error: "bad_version" };
  const timeZone = knownZone(body.timeZone);
  if (body.access === "denied") return { ok: true, value: { access: "denied", timeZone, lists: new Map(), reminders: [] } };
  if (body.access !== "full" || !Array.isArray(body.lists) || !Array.isArray(body.reminders)) return { ok: false, error: "bad_body" };
  if (body.lists.length > MAX_LISTS || body.reminders.length > MAX_REMINDERS) return { ok: false, error: "too_large" };

  const lists = new Map<string, string>();
  for (const list of body.lists) {
    if (isObject(list) && typeof list.id === "string" && list.id.length > 0 && list.id.length <= MAX_ID) {
      lists.set(list.id, text(list.name, MAX_LIST_NAME)?.trim() ?? "");
    }
  }
  const seen = new Set<string>();
  const reminders: RelayReminder[] = [];
  for (const raw of body.reminders) {
    const reminder = parseReminder(raw);
    if (!reminder || seen.has(reminder.id)) continue; // a reminder listed twice is stored once
    seen.add(reminder.id);
    reminders.push(reminder);
  }
  return { ok: true, value: { access: "full", timeZone, lists, reminders } };
}

/** EventKit's 0 to 9 as tasks have it: 1 to 4 high, 5 medium, 6 to 9 low, anything else none. */
export function taskPriority(priority: number): 1 | 2 | 3 | null {
  if (priority >= 1 && priority <= 4) return 1;
  if (priority === 5) return 2;
  if (priority >= 6 && priority <= 9) return 3;
  return null;
}

/**
 * When a reminder is due, as tasks store it: a day with no time is midnight UTC of that day and all day, like
 * Google Tasks; a time with a zone is converted to UTC; a floating time is read in the Mac's zone, else UTC.
 */
export function dueAt(due: RelayDue | null, macZone: string | null): { due_at: string | null; due_all_day: boolean } {
  const day = due && DATE.exec(due.date);
  if (!due || !day) return { due_at: null, due_all_day: true };
  const [y, mo, d] = [Number(day[1]), Number(day[2]), Number(day[3])];
  if (new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d || mo < 1 || mo > 12) return { due_at: null, due_all_day: true }; // 2026-02-30
  const time = due.time ? TIME.exec(due.time) : null;
  if (!time) return { due_at: `${due.date}T00:00:00.000Z`, due_all_day: true };
  const [h, mi, s] = [Number(time[1]), Number(time[2]), Number(time[3] ?? 0)];
  if (h > 23 || mi > 59 || s > 59) return { due_at: `${due.date}T00:00:00.000Z`, due_all_day: true };
  const zone = due.timeZone ?? macZone;
  const ms = (zone ? zonedToUtc(y, mo, d, h, mi, s, zone) : null) ?? Date.UTC(y, mo - 1, d, h, mi, s);
  return { due_at: new Date(ms).toISOString(), due_all_day: false };
}

/** One reminder as a task row, before sealing. A completed one with no completion date keeps none. */
export function taskFields(reminder: RelayReminder, sync: Pick<RelaySync, "lists" | "timeZone">): TaskFields {
  return {
    provider_task_id: reminder.id,
    list_id: reminder.listId,
    list_name: sync.lists.get(reminder.listId) || null,
    title: reminder.title.trim(),
    notes: reminder.notes?.trim() || null,
    ...dueAt(reminder.due, sync.timeZone),
    status: reminder.completed ? "completed" : "open",
    completed_at: reminder.completed ? reminder.completedAt : null,
    priority: taskPriority(reminder.priority),
  };
}

/** What the relay can say went wrong applying a change, in words for the app. */
const REPORT_ERRORS: Record<string, string> = {
  not_found: "This reminder is no longer in Reminders on your Mac.",
  read_only: "This reminder is in a list you cannot change, such as one shared with you as read only.",
  denied: "Konva Relay is not allowed to change Reminders on your Mac. Allow it in System Settings, Privacy and Security, Reminders.",
  save_failed: "Reminders on your Mac did not save this change. Try again.",
};

/** A result from the relay for one queued change. An unknown error code still fails, with a general reason. */
export function parseReport(body: unknown): Parsed<{ ok: true } | { ok: false; error: string }> {
  if (!isObject(body) || typeof body.ok !== "boolean") return { ok: false, error: "bad_body" };
  if (body.ok) return { ok: true, value: { ok: true } };
  const code = typeof body.error === "string" ? body.error : "";
  return { ok: true, value: { ok: false, error: REPORT_ERRORS[code] ?? "Reminders on your Mac could not make this change. Try again." } };
}

/** A queued change as the relay receives it. */
export interface RelayUpdate {
  id: string;
  reminderId: string;
  action: "complete" | "reopen";
}
