// Calendar view names, grid measurements and the labels the views print for dates and times. The date arithmetic
// itself (dayKey, addDays, startOfWeek ...) is in lib/dates.ts.


import { allDayLast, allDaySpanText } from "@/lib/calendar-days";
import type { CalendarEvent } from "@/lib/calendar";
import { addDays, dayKey, fromKey } from "@/lib/dates";
import { timeOf } from "@/lib/format";


export type View = "agenda" | "day" | "week";

export const HOUR = 48; // height of an hour in the week view, in pixels
export const MIN_EVENT = 20; // shortest an event is drawn, in minutes, so its title fits
export const MAX_COLUMNS = 3; // events that overlap share a day's width up to this many ways in a narrow column (the week)
export const MAX_COLUMNS_WIDE = 5; // and this many in a wide one (the day view)
export const LABELS = 56; // width of the hour labels, in pixels
export const DAY_MIN = 80; // narrowest a day column in the week view is allowed to be, in pixels

/**
 * "Tuesday, 10 November", the way Calendar writes a day everywhere, with the year added when it is not this year's (or
 * always, with `year`). Built by hand: en-GB leaves out the comma after the weekday.
 */
export function longDate(d: Date, today?: Date, year = false) {
  const weekday = d.toLocaleDateString("en-GB", { weekday: "long" });
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  return `${weekday}, ${date}${year || (today && d.getFullYear() !== today.getFullYear()) ? ` ${d.getFullYear()}` : ""}`;
}

/** Today, Tomorrow and Yesterday by name, any other day as its long date. */
export function dayName(key: string, today: Date): string | null {
  if (key === dayKey(today)) return "Today";
  if (key === dayKey(addDays(today, 1))) return "Tomorrow";
  if (key === dayKey(addDays(today, -1))) return "Yesterday";
  return null;
}

export function dayTitle(key: string, today: Date) {
  return dayName(key, today) ?? longDate(fromKey(key), today);
}

export function rangeLabel(start: Date, end: Date, today: Date) {
  const last = addDays(end, -1);
  const sameMonth = start.getMonth() === last.getMonth() && start.getFullYear() === last.getFullYear();
  const from = start.toLocaleDateString("en-GB", sameMonth ? { day: "numeric" } : { day: "numeric", month: "long" });
  const to = last.toLocaleDateString("en-GB", { day: "numeric", month: "long", ...(last.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
  return start.getTime() === last.getTime() ? to : `${from} to ${to}`;
}

/** "09:00 to 10:00", or the end day as well when the event runs past midnight. */
export function timeRange(e: CalendarEvent) {
  if (e.allDay) return allDaySpanText(e) ?? "All Day";
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
  if (e.allDay) return dayKey(now) > allDayLast(e);
  return new Date(e.endsAt ?? e.startsAt).getTime() < now.getTime();
}

