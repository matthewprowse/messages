// Tests for components/calendar/dates.ts: the labels the views print (day titles, ranges, time ranges), the order events
// are listed in, and when an event is drawn dimmed. All-day events are calendar dates, so "over" means its last day is
// done, not that midnight UTC has passed.

import assert from "node:assert/strict";
import test from "node:test";
import type { CalendarEvent } from "@/lib/calendar";
import { byTime, dayTitle, isDimmed, rangeLabel, timeRange } from "./dates";

const event = (over: Partial<CalendarEvent>): CalendarEvent => ({ id: "e", title: "Meeting", startsAt: "", endsAt: null, allDay: false, location: null, attendees: [], ...over });
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);
const today = at(4, 12);

test("today, tomorrow and yesterday have names, other days a full date with the year only when it differs", () => {
  assert.equal(dayTitle("2026-11-04", today), "Today");
  assert.equal(dayTitle("2026-11-05", today), "Tomorrow");
  assert.equal(dayTitle("2026-11-03", today), "Yesterday");
  assert.equal(dayTitle("2026-11-20", today), "Friday 20 November");
  assert.match(dayTitle("2027-01-05", today), /2027/);
});

test("a range reads 2 to 8 Nov, and spells the months when they differ", () => {
  assert.equal(rangeLabel(at(2, 0), at(9, 0), today), "2 to 8 Nov");
  assert.equal(rangeLabel(new Date(2026, 9, 28), new Date(2026, 10, 4), today), "28 Oct to 3 Nov");
  assert.equal(rangeLabel(at(4, 0), at(5, 0), today), "4 Nov");
});

test("a timed event reads from start to end, with the end day when it runs past midnight", () => {
  assert.equal(timeRange(event({ startsAt: at(4, 9).toISOString(), endsAt: at(4, 10, 30).toISOString() })), "09:00 to 10:30");
  assert.equal(timeRange(event({ startsAt: at(4, 9).toISOString(), endsAt: at(4, 9).toISOString() })), "09:00");
  assert.match(timeRange(event({ startsAt: at(4, 22).toISOString(), endsAt: at(5, 1).toISOString() })), /^22:00 to .*5 Nov.*01:00$/);
});

test("an all-day event reads All Day, or the days it spans", () => {
  assert.equal(timeRange(event({ allDay: true, startsAt: "2026-11-04T00:00:00Z", endsAt: "2026-11-05T00:00:00Z" })), "All Day");
  assert.equal(timeRange(event({ allDay: true, startsAt: "2026-11-04T00:00:00Z", endsAt: "2026-11-07T00:00:00Z" })), "4 to 6 November 2026");
});

test("all-day events are listed first, then by start time, then by title", () => {
  const list = [
    event({ id: "c", title: "B", startsAt: at(4, 9).toISOString() }),
    event({ id: "a", title: "Day", allDay: true, startsAt: "2026-11-04T00:00:00Z" }),
    event({ id: "d", title: "A", startsAt: at(4, 9).toISOString() }),
    event({ id: "b", title: "Early", startsAt: at(4, 7).toISOString() }),
  ];
  assert.deepEqual(list.sort(byTime).map((e) => e.id), ["a", "b", "d", "c"]);
});

test("a timed event is dimmed once it has ended, a declined one always", () => {
  const meeting = event({ startsAt: at(4, 9).toISOString(), endsAt: at(4, 10).toISOString() });
  assert.equal(isDimmed(meeting, at(4, 9, 30)), false);
  assert.equal(isDimmed(meeting, at(4, 10, 1)), true);
  assert.equal(isDimmed(event({ ...meeting, response: "declined" }), at(4, 8)), true);
  assert.equal(isDimmed(event({ startsAt: at(4, 9).toISOString() }), at(4, 9, 1)), true); // no end: over when it starts
});

test("an all-day event stays bright through its last day", () => {
  const trip = event({ allDay: true, startsAt: "2026-11-03T00:00:00Z", endsAt: "2026-11-06T00:00:00Z" }); // 3, 4 and 5 November
  assert.equal(isDimmed(trip, at(5, 23, 59)), false);
  assert.equal(isDimmed(trip, at(6, 0, 1)), true);
  const one = event({ allDay: true, startsAt: "2026-11-03T00:00:00Z", endsAt: "2026-11-04T00:00:00Z" });
  assert.equal(isDimmed(one, at(3, 18)), false);
  assert.equal(isDimmed(one, at(4, 0, 1)), true);
});
