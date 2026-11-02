// Which days a calendar event covers and how that reads: the days a timed or all-day event appears on, the span of a
// multi-day all-day event ("Day 2 of 3", "3 to 5 November"), and an event row's detail line. Pure and in the browser's
// time zone; all-day dates are calendar dates (stored as midnight UTC with an end that is not included), so they are
// compared as written. The loading is in calendar.ts.

import { addDays, dayKey, fromKey, shiftKey } from "./dates";
import { timeOf } from "./format";
import type { CalendarEvent } from "./calendar";

/**
 * The local days an event appears on, within the given days. Timed events show on every day they run,
 * so one that started before the first day shown still appears; ending at midnight does not count that day.
 */
export function daysOf(event: CalendarEvent, days: string[]): string[] {
  if (!event.allDay) {
    const start = new Date(event.startsAt);
    const first = dayKey(start);
    const end = event.endsAt ? new Date(event.endsAt) : null;
    const last = end && end > start ? dayKey(new Date(end.getTime() - 1)) : first;
    return days.filter((d) => d >= first && d <= last);
  }
  const first = allDayFirst(event);
  const last = allDayLast(event);
  return days.filter((d) => d >= first && d <= last);
}

/** An all-day event's first day as "YYYY-MM-DD". */
export function allDayFirst(event: Pick<CalendarEvent, "startsAt">): string {
  return event.startsAt.slice(0, 10);
}

/** An all-day event's last day (its stored end is the day after), or its first when it has no usable end. */
export function allDayLast(event: Pick<CalendarEvent, "startsAt" | "endsAt">): string {
  const first = allDayFirst(event);
  const end = event.endsAt ? event.endsAt.slice(0, 10) : null;
  return end && end > first ? shiftKey(end, -1) : first;
}

/** How many days an all-day event covers; 1 for a one-day event. */
export function allDayLength(event: Pick<CalendarEvent, "startsAt" | "endsAt">): number {
  return Math.round((fromKey(allDayLast(event)).getTime() - fromKey(allDayFirst(event)).getTime()) / 86_400_000) + 1;
}

/** "Day 2 of 3" for a multi-day all-day event on one of its days, else null. Counted by calendar day, so a clock change cannot skew it. */
export function allDayPosition(event: CalendarEvent, day: string): string | null {
  if (!event.allDay) return null;
  const total = allDayLength(event);
  if (total < 2) return null;
  let index = 0;
  for (let d = fromKey(allDayFirst(event)); dayKey(d) < day && index < total; d = addDays(d, 1)) index++;
  return `Day ${Math.min(index + 1, total)} of ${total}`;
}

/** "3 to 5 November 2026" for a multi-day all-day event (both months when they differ), else null. */
export function allDaySpanText(event: CalendarEvent): string | null {
  if (!event.allDay || allDayLength(event) < 2) return null;
  const first = fromKey(allDayFirst(event));
  const last = fromKey(allDayLast(event));
  const sameMonth = first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear();
  const from = first.toLocaleDateString("en-GB", sameMonth ? { day: "numeric" } : { day: "numeric", month: "long" });
  const to = last.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return `${from} to ${to}`;
}

/** An event row's second line: when, where and who, such as "09:00 to 10:00 · Office · Sarah Lee". */
export function eventDetail(e: CalendarEvent) {
  const who = e.attendees.map((a) => a.name).join(", ");
  // All Day already sits on the right, so an all-day event's line starts with where.
  const when = e.allDay ? "" : e.endsAt && e.endsAt !== e.startsAt ? `${timeOf(e.startsAt)} to ${timeOf(e.endsAt)}` : timeOf(e.startsAt);
  return [when, e.location, who].filter(Boolean).join(" · ") || "All Day";
}
