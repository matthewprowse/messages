// Tests for day-layout.ts: how timed events share a day column, which ones fall off a narrow column into "+N", and
// how a long or midnight-crossing event is clipped to the day. Also dayRows (day-rows.ts), the order of the agenda list.

import assert from "node:assert/strict";
import test from "node:test";
import type { CalendarEvent } from "@/lib/calendar";
import type { DayTask } from "@/lib/tasks";
import type { Task } from "@/lib/types";
import { MAX_COLUMNS_WIDE } from "./dates";
import { layoutDay, taskSlot } from "./day-layout";
import { dayRows } from "./day-rows";

const KEY = "2026-11-04";
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString();
const ev = (id: string, startH: number, endH: number | null, startM = 0): CalendarEvent => ({
  id, title: id, startsAt: at(4, startH, startM), endsAt: endH === null ? null : at(4, endH), allDay: false, location: null, attendees: [],
});

test("events that do not overlap each take the whole width", () => {
  const { items, more } = layoutDay(KEY, [ev("a", 9, 10), ev("b", 10, 11)]);
  assert.deepEqual(items.map((i) => [i.event.id, i.col, i.cols]), [["a", 0, 1], ["b", 0, 1]]);
  assert.equal(more.length, 0);
});

test("events that overlap share the width", () => {
  const { items } = layoutDay(KEY, [ev("a", 9, 11), ev("b", 10, 12)]);
  assert.deepEqual(items.map((i) => [i.col, i.cols]), [[0, 2], [1, 2]]);
});

test("overlap chains through a middle event and ends when the gap comes", () => {
  const { items } = layoutDay(KEY, [ev("a", 9, 10), ev("b", 9, 12), ev("c", 11, 12), ev("d", 13, 14)]);
  const cols = Object.fromEntries(items.map((i) => [i.event.id, i.cols]));
  assert.deepEqual(cols, { a: 2, b: 2, c: 2, d: 1 });
});

test("the fourth meeting at once is left out of a narrow column and handed back for the +N list", () => {
  const four = [ev("a", 9, 10), ev("b", 9, 10), ev("c", 9, 10), ev("d", 9, 10)];
  const { items, more } = layoutDay(KEY, four);
  assert.equal(items.length, 3);
  assert.equal(more.length, 1);
  assert.equal(more[0].count, 1);
  assert.deepEqual(more[0].events.map((e) => e.id), ["d"]);
});

test("a wide column (the day view) fits five side by side before anything is left out", () => {
  const five = ["a", "b", "c", "d", "e"].map((id) => ev(id, 9, 10));
  assert.equal(layoutDay(KEY, five, 0, MAX_COLUMNS_WIDE).more.length, 0);
  assert.equal(layoutDay(KEY, [...five, ev("f", 9, 10)], 0, MAX_COLUMNS_WIDE).more[0].count, 1);
});

test("a short or open ended event is drawn at least as tall as its title needs", () => {
  const { items } = layoutDay(KEY, [ev("a", 9, null)]);
  assert.equal(items[0].bottom - items[0].top, 20);
});

test("an event from the day before starts at the top, and one running past midnight stops at the bottom", () => {
  const early = { ...ev("a", 0, 3), startsAt: at(3, 22) };
  const late = { ...ev("b", 22, 23), endsAt: at(5, 2) };
  const { items } = layoutDay(KEY, [early, late]);
  const byId = Object.fromEntries(items.map((i) => [i.event.id, i]));
  assert.equal(byId.a.top, 0);
  assert.equal(byId.b.bottom, 1440);
});

test("the first drawn minute clips events above it in the phone layout", () => {
  const { items } = layoutDay(KEY, [ev("a", 6, 7)], 480);
  assert.equal(items[0].top, 480);
});

test("a timed task takes thirty minutes beside the events", () => {
  const task = { id: "t1", dueAt: at(4, 9), dueAllDay: false, completed: false } as unknown as Task;
  const slot = taskSlot({ task, overdue: false, timed: true } as DayTask);
  const { items } = layoutDay(KEY, [ev("a", 9, 10), slot]);
  assert.equal(items.length, 2);
  assert.equal(items[0].cols, 2);
  assert.equal(Date.parse(slot.endsAt) - Date.parse(slot.startsAt), 30 * 60_000);
});

test("the agenda lists all-day events, then overdue and all-day tasks, then the rest by time", () => {
  const allDay: CalendarEvent = { ...ev("holiday", 0, null), allDay: true, startsAt: "2026-11-04T00:00:00Z" };
  const task = (id: string, over: Partial<DayTask>, dueAt: string | null = null): DayTask => ({ task: { id, dueAt } as unknown as Task, overdue: false, timed: false, ...over });
  const rows = dayRows(
    [ev("late", 15, 16), allDay, ev("early", 8, 9)],
    [task("overdue", { overdue: true }, at(2, 0)), task("anytime", {}), task("noon", { timed: true }, at(4, 12))],
  );
  assert.deepEqual(rows.map((r) => r.id), ["holiday", "overdue", "anytime", "early", "noon", "late"]);
});
