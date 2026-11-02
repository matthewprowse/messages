// The order of one day's rows in the agenda list: events and tasks together. Pure, so it is unit tested.

import type { CalendarEvent } from "@/lib/calendar";
import type { DayTask } from "@/lib/tasks";

/** A day's events and tasks in one list: all-day events, then overdue and all-day tasks, then the rest by time. */
export function dayRows(events: CalendarEvent[], tasks: DayTask[]): { id: string; event?: CalendarEvent; task?: DayTask }[] {
  const rank = (row: { event?: CalendarEvent; task?: DayTask }) => (row.event ? (row.event.allDay ? 0 : 3) : row.task!.overdue ? 1 : row.task!.timed ? 3 : 2);
  const at = (row: { event?: CalendarEvent; task?: DayTask }) => row.event?.startsAt ?? row.task!.task.dueAt ?? "";
  const rows = [...events.map((event) => ({ id: event.id, event })), ...tasks.map((task) => ({ id: task.task.id, task }))];
  return rows.sort((a, b) => rank(a) - rank(b) || Date.parse(at(a)) - Date.parse(at(b)));
}
