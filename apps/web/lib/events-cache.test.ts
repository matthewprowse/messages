// Tests for events-cache.ts: keys keep people, ranges and detail apart, and a Realtime patch puts changed events in
// order, drops removed and moved-away ones, and leaves the rest alone.

import { test } from "node:test";
import assert from "node:assert/strict";
import { eventsKey, inLoadWindow, patchRange } from "./events-cache";
import type { CalendarEvent } from "./calendar";

const ev = (id: string, startsAt: string, endsAt: string | null = null) => ({ id, title: id, startsAt, endsAt, allDay: false, location: null, attendees: [] }) as CalendarEvent;
const start = new Date("2026-11-02T00:00:00Z");
const end = new Date("2026-11-09T00:00:00Z");

test("keys differ by person, start, length and detail", () => {
  const keys = new Set([eventsKey("u1", "2026-11-02", 7, false), eventsKey("u2", "2026-11-02", 7, false), eventsKey("u1", "2026-11-03", 7, false), eventsKey("u1", "2026-11-02", 1, false), eventsKey("u1", "2026-11-02", 7, true)]);
  assert.equal(keys.size, 5);
});

test("the load window reaches a day either side, and counts events still going at its start", () => {
  assert.ok(inLoadWindow(ev("a", "2026-11-01T06:00:00Z"), start, end));
  assert.ok(!inLoadWindow(ev("b", "2026-10-30T06:00:00Z", "2026-10-30T07:00:00Z"), start, end));
  assert.ok(inLoadWindow(ev("c", "2026-10-20T06:00:00Z", "2026-11-03T07:00:00Z"), start, end));
  assert.ok(!inLoadWindow(ev("d", "2026-11-10T06:00:00Z"), start, end));
});

test("a changed event replaces its old copy and takes its place by start time", () => {
  const a = ev("a", "2026-11-03T09:00:00Z");
  const b = ev("b", "2026-11-04T09:00:00Z");
  const moved = ev("a", "2026-11-05T09:00:00Z");
  const out = patchRange([a, b], [moved], [], start, end);
  assert.deepEqual(out.map((e) => [e.id, e.startsAt]), [["b", "2026-11-04T09:00:00Z"], ["a", "2026-11-05T09:00:00Z"]]);
  assert.equal(out[0], b);
});

test("a deleted event goes, and one moved out of the range goes too", () => {
  const a = ev("a", "2026-11-03T09:00:00Z");
  const b = ev("b", "2026-11-04T09:00:00Z");
  assert.deepEqual(patchRange([a, b], [], ["a"], start, end).map((e) => e.id), ["b"]);
  assert.deepEqual(patchRange([a, b], [ev("b", "2026-12-01T09:00:00Z")], [], start, end).map((e) => e.id), ["a"]);
});

test("nothing to change returns the same list", () => {
  const list = [ev("a", "2026-11-03T09:00:00Z")];
  assert.equal(patchRange(list, [], ["zzz"], start, end), list);
});
