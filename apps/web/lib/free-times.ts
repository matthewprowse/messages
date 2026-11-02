// Free times to offer a client: the gaps in working hours between events, as text such as "Thursday 14:00 to 15:00,
// Friday 09:30 to 10:30". Pure, so it is unit tested: time zones are worked out with Intl and never with the machine's
// own zone, so the answer is the same wherever it runs.
//
// All-day events (birthdays, holidays, "Working from home") do not block time, except ones over several days, which
// are leave or a conference. Declined events are not known here, so every timed event blocks: offering a time that is
// taken is worse than leaving one out.

export interface Busy {
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
}

/** Working hours as minutes from midnight. */
export interface WorkingHours {
  start: number;
  end: number;
}

export interface FreeSlot {
  start: Date;
  end: Date;
}

export interface FreeDay {
  /** "YYYY-MM-DD" in the time zone. */
  day: string;
  slots: FreeSlot[];
}

export const DEFAULT_HOURS: WorkingHours = { start: 8 * 60, end: 17 * 60 };
export const STEP_MINUTES = 15; // slots start and end on the quarter hour
export const MAX_SLOTS_PER_DAY = 3; // the longest gaps; a list longer than that stops being easy to read
const MINUTE = 60_000;
const DAY = 86_400_000;

interface Wall {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  s: number;
}

function wallOf(at: number, timeZone: string): Wall {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute"), s: get("second") };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The calendar day of an instant in a zone, "YYYY-MM-DD". */
export function dayInZone(at: number | Date, timeZone: string): string {
  const w = wallOf(typeof at === "number" ? at : at.getTime(), timeZone);
  return `${w.y}-${pad(w.m)}-${pad(w.d)}`;
}

/** The instant a wall clock (minutes after midnight on a day) is in a zone. Two passes settle the offset across a clock change. */
export function instantAt(day: string, minutes: number, timeZone: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, minutes);
  const offset = (at: number) => {
    const w = wallOf(at, timeZone);
    return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - Math.floor(at / 1000) * 1000;
  };
  const first = naive - offset(naive);
  return naive - offset(first);
}

/** A day moved by whole days. */
export function addDaysKey(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** True for Monday to Friday. */
export function isWorkingDay(day: string): boolean {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday >= 1 && weekday <= 5;
}

/** "HH:MM" of an instant in a zone. */
export function clockIn(at: number | Date, timeZone: string): string {
  const w = wallOf(typeof at === "number" ? at : at.getTime(), timeZone);
  return `${pad(w.h)}:${pad(w.min)}`;
}

/** The days to offer: the next `count` working days, starting today if working hours have not ended yet. */
export function nextWorkingDays(now: Date, count: number, hours: WorkingHours, timeZone: string): string[] {
  const today = dayInZone(now, timeZone);
  const out: string[] = [];
  for (let day = today; out.length < count && day <= addDaysKey(today, count * 3 + 14); day = addDaysKey(day, 1)) {
    if (!isWorkingDay(day)) continue;
    if (day === today && instantAt(day, hours.end, timeZone) <= now.getTime()) continue;
    out.push(day);
  }
  return out;
}

/** The working days from one day to another, both included. Capped at 31 days so a wide pick stays a short message. */
export function workingDaysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = from, n = 0; day <= to && n < 31; day = addDaysKey(day, 1), n++) if (isWorkingDay(day)) out.push(day);
  return out;
}

/** Busy intervals for one day's window, as [start, end] instants. */
function busyIntervals(busy: Busy[], windowStart: number, windowEnd: number, day: string): [number, number][] {
  const out: [number, number][] = [];
  for (const b of busy) {
    if (b.allDay) {
      // Stored as midnight UTC on its date, with the end date not included; only a stretch of several days blocks.
      const first = b.startsAt.slice(0, 10);
      const after = (b.endsAt ?? b.startsAt).slice(0, 10);
      if (addDaysKey(first, 1) < after && day >= first && day < after) out.push([windowStart, windowEnd]);
      continue;
    }
    const start = Date.parse(b.startsAt);
    const end = b.endsAt ? Date.parse(b.endsAt) : start + 60 * MINUTE;
    if (Number.isNaN(start) || Number.isNaN(end) || end <= windowStart || start >= windowEnd) continue;
    out.push([Math.max(start, windowStart), Math.min(end, windowEnd)]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

const ceilTo = (ms: number, step: number) => Math.ceil(ms / step) * step;
const floorTo = (ms: number, step: number) => Math.floor(ms / step) * step;

/**
 * The free gaps of one day inside working hours, at least `minMinutes` long, starting and ending on the quarter hour.
 * Today's window starts at `now`. The day's clock is the zone's, so working hours are the person's own wherever the
 * browser or server runs.
 */
export function freeSlotsOn(day: string, busy: Busy[], opts: { hours: WorkingHours; timeZone: string; now: Date; minMinutes: number }): FreeSlot[] {
  const { hours, timeZone, now, minMinutes } = opts;
  const step = STEP_MINUTES * MINUTE;
  let cursor = instantAt(day, hours.start, timeZone);
  const end = instantAt(day, hours.end, timeZone);
  cursor = Math.max(cursor, now.getTime());
  const slots: FreeSlot[] = [];
  const take = (from: number, to: number) => {
    const start = ceilTo(from, step);
    const stop = floorTo(to, step);
    if (stop - start >= minMinutes * MINUTE) slots.push({ start: new Date(start), end: new Date(stop) });
  };
  for (const [from, to] of busyIntervals(busy, cursor, end, day)) {
    if (from > cursor) take(cursor, from);
    cursor = Math.max(cursor, to);
  }
  if (cursor < end) take(cursor, end);
  return slots;
}

/** The free gaps of each of these days; days with none are left out. */
export function freeTimes(days: string[], busy: Busy[], opts: { hours?: WorkingHours; timeZone: string; now: Date; minMinutes?: number }): FreeDay[] {
  const hours = opts.hours ?? DEFAULT_HOURS;
  const out: FreeDay[] = [];
  for (const day of days) {
    const slots = freeSlotsOn(day, busy, { hours, timeZone: opts.timeZone, now: opts.now, minMinutes: opts.minMinutes ?? 30 });
    if (slots.length) out.push({ day, slots });
  }
  return out;
}

function dayLabel(day: string, today: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  const weekday = date.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  // A weekday alone is clear within the coming week; further out it needs the date.
  return (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY > 6 ? `${weekday} ${date.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })}` : weekday;
}

/**
 * The text to paste into a reply: "Thursday 14:00 to 15:00, Friday 09:30 to 10:30". Every slot names its day, so a
 * list can be cut anywhere. A day keeps its longest gaps (MAX_SLOTS_PER_DAY), in time order. Empty when nothing is free.
 */
export function formatFreeTimes(days: FreeDay[], timeZone: string, now: Date): string {
  const today = dayInZone(now, timeZone);
  const parts: string[] = [];
  for (const { day, slots } of days) {
    const longest = [...slots].sort((a, b) => b.end.getTime() - b.start.getTime() - (a.end.getTime() - a.start.getTime())).slice(0, MAX_SLOTS_PER_DAY);
    longest.sort((a, b) => a.start.getTime() - b.start.getTime());
    for (const s of longest) parts.push(`${dayLabel(day, today)} ${clockIn(s.start, timeZone)} to ${clockIn(s.end, timeZone)}`);
  }
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Working hours the person chose, kept in the browser (a per-person convenience, so a blocked storage just means the default).
// ---------------------------------------------------------------------------

const HOURS_KEY = "konva:working-hours";
type Store = Pick<Storage, "getItem" | "setItem">;

/** The remembered working hours, or the default when none, unreadable, or not sensible (end after start, in a day). */
export function readHours(storage: Store | null): WorkingHours {
  try {
    const parsed = JSON.parse(storage?.getItem(HOURS_KEY) ?? "null") as Partial<WorkingHours> | null;
    const ok = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 24 * 60;
    if (parsed && ok(parsed.start) && ok(parsed.end) && parsed.end > parsed.start) return { start: parsed.start, end: parsed.end };
  } catch {
    // Unreadable or blocked: the default.
  }
  return DEFAULT_HOURS;
}

export function writeHours(storage: Store | null, hours: WorkingHours): void {
  try {
    storage?.setItem(HOURS_KEY, JSON.stringify(hours));
  } catch {
    // Blocked or full: the choice lasts until the page is closed.
  }
}

/** "HH:MM" to minutes after midnight, or null when it is not a time. */
export function minutesOf(time: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Minutes after midnight as "HH:MM". */
export const timeOfMinutes = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
