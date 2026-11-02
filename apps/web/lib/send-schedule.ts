// When a message goes out: the Undo Send window (kept in this browser), the Send Later choices, and how a time reads in
// the conversation. Times are the user's local time (the browser's zone, SAST for most users). Pure apart from the
// storage argument; the outbox rows carry the result in send_after and the worker does not send before it.

/** Undo Send windows offered in Settings, in seconds. 0 is Off. */
export const UNDO_CHOICES = [0, 5, 10, 20, 30] as const;
export const DEFAULT_UNDO_SECONDS = 10;
/** A row whose send_after is further than this past its creation is a scheduled send, not an Undo window (the longest is 30 s). */
export const SCHEDULED_AFTER_MS = 60_000;
/** How far ahead Send Later may go; the database check allows a little over a year. */
export const MAX_SCHEDULE_DAYS = 365;

const KEY = "konva.undoSendSeconds";

/** The Undo window from a stored value; anything that is not one of the choices means the default. */
export function undoSecondsFrom(raw: string | null | undefined): number {
  const n = raw === null || raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return (UNDO_CHOICES as readonly number[]).includes(n) ? n : DEFAULT_UNDO_SECONDS;
}

function safeStorage(): Storage | undefined {
  try { return typeof localStorage === "undefined" ? undefined : localStorage; } catch { return undefined; }
}

export function readUndoSeconds(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): number {
  try { return undoSecondsFrom(storage?.getItem(KEY)); } catch { return DEFAULT_UNDO_SECONDS; }
}

export function writeUndoSeconds(seconds: number, storage: Pick<Storage, "setItem"> | undefined = safeStorage()) {
  try { storage?.setItem(KEY, String(seconds)); } catch { /* a blocked store only means the default applies next time */ }
}

/** send_after for an Undo window, or null when it is Off. */
export function sendAfterIso(seconds: number, now = Date.now()): string | null {
  return seconds > 0 ? new Date(now + seconds * 1000).toISOString() : null;
}

/** Whether a queued row is waiting for a chosen time rather than only for its Undo window. */
export function isScheduled(sendAfter: string | null | undefined, createdAt: string): boolean {
  if (!sendAfter) return false;
  const gap = Date.parse(sendAfter) - Date.parse(createdAt);
  return Number.isFinite(gap) && gap > SCHEDULED_AFTER_MS;
}

export interface LaterChoice { key: "today" | "tomorrow" | "monday"; label: string; at: Date }

function at(day: Date, hours: number, minutes = 0): Date {
  const d = new Date(day);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function addDays(day: Date, n: number): Date {
  const d = new Date(day);
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * The quick choices. Later Today is three hours on, rounded up to the half hour, and only offered when that is still
 * today. Tomorrow Morning is 08:00. Monday is the next Monday at 08:00, and is left out when tomorrow already is Monday.
 */
export function laterChoices(now: Date): LaterChoice[] {
  const out: LaterChoice[] = [];
  const soon = new Date(now.getTime() + 3 * 3_600_000);
  soon.setSeconds(0, 0);
  soon.setMinutes(soon.getMinutes() <= 30 ? (soon.getMinutes() === 0 ? 0 : 30) : 60);
  if (soon.getDate() === now.getDate() && soon > now) out.push({ key: "today", label: "Later Today", at: soon });
  const tomorrow = addDays(now, 1);
  out.push({ key: "tomorrow", label: "Tomorrow Morning", at: at(tomorrow, 8) });
  const untilMonday = ((8 - now.getDay()) % 7) || 7;
  if (untilMonday > 1) out.push({ key: "monday", label: "Monday Morning", at: at(addDays(now, untilMonday), 8) });
  return out;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (n: number) => String(n).padStart(2, "0");

/** A time as it reads in the conversation: "Today 14:30", "Tomorrow 08:00", "Mon 23 Nov 08:00" (with the year when it is not this one). */
export function describeWhen(when: Date, now: Date): string {
  const time = `${two(when.getHours())}:${two(when.getMinutes())}`;
  const dayDiff = Math.round((at(when, 0).getTime() - at(now, 0).getTime()) / 86_400_000);
  if (dayDiff === 0) return `Today ${time}`;
  if (dayDiff === 1) return `Tomorrow ${time}`;
  const year = when.getFullYear() === now.getFullYear() ? "" : ` ${when.getFullYear()}`;
  return `${DAYS[when.getDay()]} ${when.getDate()} ${MONTHS[when.getMonth()]}${year} ${time}`;
}

/** A calendar day plus an "HH:MM" box value as a local time, or null when the time is missing or not a time. */
export function combineDateTime(day: Date | undefined, time: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!day || !m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h > 23 || min > 59 ? null : at(day, h, min);
}

/** Why a chosen time cannot be used, or null when it can. */
export function scheduleError(when: Date | null, now: Date): string | null {
  if (!when) return "Choose a day and a time.";
  if (when.getTime() <= now.getTime() + 60_000) return "Choose a time in the future.";
  if (when.getTime() > now.getTime() + MAX_SCHEDULE_DAYS * 86_400_000) return "Choose a time within the next year.";
  return null;
}
