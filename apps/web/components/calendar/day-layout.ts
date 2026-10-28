// Lays timed events and tasks out side by side inside a day column.


import { type CalendarEvent } from "@/lib/calendar";
import { type DayTask } from "@/lib/tasks";

import { MAX_COLUMNS, MIN_EVENT, fromKey, pad } from "./dates";

/** A timed task in a day column, laid out with the events so neither covers the other. It takes TASK_MINUTES, room for its checkbox. */
export type TaskSlot = { id: string; startsAt: string; endsAt: string; item: DayTask };

export const TASK_MINUTES = 30;

export function taskSlot(item: DayTask): TaskSlot {
  const at = item.task.dueAt!;
  return { id: item.task.id, startsAt: at, endsAt: new Date(Date.parse(at) + TASK_MINUTES * 60_000).toISOString(), item };
}

export const isSlot = (x: CalendarEvent | TaskSlot): x is TaskSlot => "item" in x;

/**
 * Where each timed event sits in a day column: minutes from midnight, and which of how many side by
 * side columns it takes when it overlaps others. Beyond MAX_COLUMNS side by side the rest are left out of the
 * grid (they are still in the list) and counted in `more`. `from` is the first minute drawn.
 */
export function layoutDay<T extends { startsAt: string; endsAt: string | null }>(key: string, events: T[], from = 0) {
  const dayStart = fromKey(key).getTime();
  const all = events
    .map((event) => {
      const start = new Date(event.startsAt).getTime();
      const end = event.endsAt ? new Date(event.endsAt).getTime() : start;
      const top = Math.max(from, (start - dayStart) / 60_000);
      const bottom = Math.max(top + MIN_EVENT, Math.min(1440, (end - dayStart) / 60_000));
      return { event, top, bottom: Math.min(1440, bottom), col: 0, cols: 1, hidden: false };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);

  // Events that overlap, directly or through each other, share the width of the column.
  const more: { top: number; count: number }[] = [];
  let cluster: typeof all = [];
  let clusterEnd = -1;
  const finish = () => {
    const shown = cluster.filter((i) => !i.hidden);
    const cols = Math.max(0, ...shown.map((i) => i.col)) + 1;
    for (const i of shown) i.cols = cols;
    const hiddenCount = cluster.length - shown.length;
    if (hiddenCount) more.push({ top: Math.min(...cluster.filter((i) => i.hidden).map((i) => i.top)), count: hiddenCount });
  };
  for (const item of all) {
    if (item.top >= clusterEnd && cluster.length) {
      finish();
      cluster = [];
    }
    const taken = new Set(cluster.filter((i) => !i.hidden && i.bottom > item.top).map((i) => i.col));
    let col = 0;
    while (taken.has(col)) col++;
    item.col = col;
    item.hidden = col >= MAX_COLUMNS;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.bottom);
  }
  if (cluster.length) finish();
  return { items: all.filter((i) => !i.hidden), more };
}

export function hourLabel(h: number) {
  return `${pad(h)}:00`;
}

