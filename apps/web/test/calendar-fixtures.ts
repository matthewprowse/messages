// Made-up calendar data for the calendar and Summary screen tests: a calendar account and a task list at example
// addresses with nothing behind them, events built relative to today so "today" tests read the same on every run, and a
// way to finish a queued calendar write as the worker would (through the Realtime callback the fake client recorded).

import type { CalendarEvent } from "@/lib/calendar";
import { dayKey } from "@/lib/dates";
import type { Account } from "@/lib/types";
import { fakeSupabase } from "./fake-supabase";

export const CALENDAR_ACCOUNT: Account = {
  id: "account-calendar", provider: "google_calendar", label: "Google Calendar", detail: "screen-test-calendar@example.com", status: "connected", sendAddresses: [],
};
export const TASKS_ACCOUNT: Account = {
  id: "account-tasks", provider: "microsoft_todo", label: "Microsoft To Do", detail: "screen-test-tasks@example.com", status: "connected", sendAddresses: [],
};

/** A date n days from today at hour:00 local time. */
export function daysFromNow(n: number, hour = 9): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, hour);
}

/** A one-hour timed event starting at `start`; override what the test is about. */
export function calendarEvent(id: string, title: string, start: Date, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id, title, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3_600_000).toISOString(), allDay: false, location: null, attendees: [], accountId: CALENDAR_ACCOUNT.id, ...extra };
}

/** Events grouped by their local day key, the way the calendar page hands them to its views. */
export function byDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const e of events) { const k = dayKey(new Date(e.startsAt)); map.set(k, [...(map.get(k) ?? []), e]); }
  return map;
}

/** The seven day keys of the week starting `from` days after today. */
export const weekKeys = (from = 0) => Array.from({ length: 7 }, (_, i) => dayKey(daysFromNow(from + i)));

/**
 * Answers inserts into a queue table with a row id, the way the database does, so the dialog under test can go on to
 * follow the row. Reads of the row (the dialog's poll) find it still queued.
 */
export function queueAccepts(table: "calendar_outbox" | "calendar_deletes" | "calendar_updates", id: string) {
  fakeSupabase.answer(`from:${table}`, { data: { id, status: "queued", error: null, html_link: null }, error: null });
}

/** The row the dialog inserted into a queue table, as the first argument of its insert(). */
export function insertedInto(table: string): Record<string, unknown> | undefined {
  const step = fakeSupabase.callsTo(`from:${table}`).flatMap((c) => c.steps).find((s) => s.name === "insert");
  return step?.args[0] as Record<string, unknown> | undefined;
}

/**
 * Finishes a followed row as the worker would, by calling the Realtime callback the dialog subscribed with. This also
 * stops the dialog's poll and give-up timers, so nothing is left running when the test ends.
 */
export function workerFinishes(table: string, id: string, row: Record<string, unknown>) {
  const channel = fakeSupabase.callsTo(`channel:${table}-${id}`)[0];
  const on = channel?.steps.find((s) => s.name === "on");
  const callback = on?.args[2] as ((payload: { new: Record<string, unknown> }) => void) | undefined;
  if (!callback) throw new Error(`Nothing is following ${table} row ${id}.`);
  callback({ new: { id, ...row } });
}

