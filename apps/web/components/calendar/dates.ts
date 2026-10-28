// Calendar dates and sizes: the view names, the grid measurements, and the date helpers every calendar view shares.


import { dayKey, type CalendarEvent } from "@/lib/calendar";
import { timeOf } from "@/lib/format";


export type View = "agenda" | "day" | "week";

export const HOUR = 48; // height of an hour in the week view, in pixels
export const MIN_EVENT = 20; // shortest an event is drawn, in minutes, so its title fits
export const MAX_COLUMNS = 3; // events that overlap share a day's width up to this many ways
export const LABELS = 56; // width of the hour labels, in pixels
export const DAY_MIN = 80; // narrowest a day column in the week view is allowed to be, in pixels

export function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** The Monday of the week the day falls in. */
export function startOfWeek(d: Date) {
  return addDays(startOfDay(d), -((d.getDay() + 6) % 7));
}

export function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function fromKey(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** A "YYYY-MM-DD" from the address bar as a date, or undefined when it is not a real one. */
export function parseKey(key: string | null) {
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return undefined;
  const d = fromKey(key);
  return dayKey(d) === key ? d : undefined;
}

export function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function dayTitle(key: string, today: Date) {
  if (key === dayKey(today)) return "Today";
  if (key === dayKey(addDays(today, 1))) return "Tomorrow";
  if (key === dayKey(addDays(today, -1))) return "Yesterday";
  const d = fromKey(key);
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}

export function rangeLabel(start: Date, end: Date, today: Date) {
  const last = addDays(end, -1);
  const sameMonth = start.getMonth() === last.getMonth() && start.getFullYear() === last.getFullYear();
  const from = start.toLocaleDateString("en-GB", sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" });
  const to = last.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(last.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
  return start.getTime() === last.getTime() ? to : `${from} to ${to}`;
}

/** "09:00 to 10:00", or the end day as well when the event runs past midnight. */
export function timeRange(e: CalendarEvent) {
  if (e.allDay) return "All Day";
  const start = timeOf(e.startsAt);
  if (!e.endsAt || e.endsAt === e.startsAt) return start;
  const sameDay = dayKey(new Date(e.startsAt)) === dayKey(new Date(e.endsAt));
  const end = sameDay ? timeOf(e.endsAt) : `${new Date(e.endsAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}, ${timeOf(e.endsAt)}`;
  return `${start} to ${end}`;
}

/** "09:00 to 10:00" for a chip, where the end day does not fit. */
export function chipRange(e: CalendarEvent) {
  return e.endsAt && e.endsAt !== e.startsAt ? `${timeOf(e.startsAt)} to ${timeOf(e.endsAt)}` : timeOf(e.startsAt);
}

/** All-day events first, then by start time. */
export function byTime(a: CalendarEvent, b: CalendarEvent) {
  return Number(b.allDay) - Number(a.allDay) || a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title);
}

/** Over already (an all-day event counts until its last day is done), or declined: drawn dimmer. */
export function isDimmed(e: CalendarEvent, now: Date) {
  if (e.response === "declined") return true;
  if (e.allDay) {
    const first = e.startsAt.slice(0, 10);
    const end = e.endsAt ? e.endsAt.slice(0, 10) : null;
    const today = dayKey(now);
    return end && end > first ? today >= end : today > first;
  }
  return new Date(e.endsAt ?? e.startsAt).getTime() < now.getTime();
}

