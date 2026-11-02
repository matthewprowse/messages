// Tests for calendar-days.ts: which days a timed or all-day event appears on, and how a multi-day all-day event reads.
// The cases that matter for South Africa (UTC+2) and elsewhere are the all-day rule (dates as written, end not
// included) and an event that ends at midnight.

import assert from "node:assert/strict";
import test from "node:test";
import type { CalendarEvent } from "./calendar";
import { allDayLast, allDayLength, allDayPosition, allDaySpanText, daysOf, eventDetail } from "./calendar-days";
import { dayKey } from "./dates";

const event = (over: Partial<CalendarEvent>): CalendarEvent => ({ id: "e", title: "Meeting", startsAt: "", endsAt: null, allDay: false, location: null, attendees: [], ...over });
const week = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];
/** A local time on a day, as the ISO string the database would hold. */
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

test("a timed event shows on its own day only", () => {
  assert.deepEqual(daysOf(event({ startsAt: local(2026, 11, 3, 9), endsAt: local(2026, 11, 3, 10) }), week), ["2026-11-03"]);
});

test("a timed event ending exactly at midnight does not spill onto the next day", () => {
  assert.deepEqual(daysOf(event({ startsAt: local(2026, 11, 3, 22), endsAt: local(2026, 11, 4, 0) }), week), ["2026-11-03"]);
});

test("an overnight event shows on both days, and one that started before the range still shows", () => {
  assert.deepEqual(daysOf(event({ startsAt: local(2026, 11, 3, 22), endsAt: local(2026, 11, 4, 2) }), week), ["2026-11-03", "2026-11-04"]);
  assert.deepEqual(daysOf(event({ startsAt: local(2026, 10, 30, 9), endsAt: local(2026, 11, 3, 17) }), week), ["2026-11-02", "2026-11-03"]);
});

test("a timed event with no end, or an end before its start, is on its start day", () => {
  assert.deepEqual(daysOf(event({ startsAt: local(2026, 11, 4, 9), endsAt: null }), week), ["2026-11-04"]);
  assert.deepEqual(daysOf(event({ startsAt: local(2026, 11, 4, 9), endsAt: local(2026, 11, 4, 8) }), week), ["2026-11-04"]);
});

test("a one day all-day event is on that date whatever the time zone, with its end the next midnight", () => {
  const holiday = event({ allDay: true, startsAt: "2026-11-04T00:00:00Z", endsAt: "2026-11-05T00:00:00Z" });
  assert.deepEqual(daysOf(holiday, week), ["2026-11-04"]);
  assert.deepEqual(daysOf(event({ allDay: true, startsAt: "2026-11-04T00:00:00Z", endsAt: null }), week), ["2026-11-04"]);
});

test("a multi-day all-day event covers each day and not the day its end points at", () => {
  const conference = event({ allDay: true, startsAt: "2026-11-03T00:00:00Z", endsAt: "2026-11-06T00:00:00Z" });
  assert.deepEqual(daysOf(conference, week), ["2026-11-03", "2026-11-04", "2026-11-05"]);
  assert.equal(allDayLast(conference), "2026-11-05");
  assert.equal(allDayLength(conference), 3);
});

test("an all-day event that began before the range carries into it", () => {
  const trip = event({ allDay: true, startsAt: "2026-10-30T00:00:00Z", endsAt: "2026-11-04T00:00:00Z" });
  assert.deepEqual(daysOf(trip, week), ["2026-11-02", "2026-11-03"]);
});

test("an all-day event whose exclusive end is the first day shown is not on it", () => {
  const ends = event({ allDay: true, startsAt: "2026-10-30T00:00:00Z", endsAt: "2026-11-02T00:00:00Z" });
  assert.deepEqual(daysOf(ends, week), []);
});

test("the days of a multi-day event read as Day 2 of 3, counted across a month end and a clock change", () => {
  const conference = event({ allDay: true, startsAt: "2026-10-30T00:00:00Z", endsAt: "2026-11-02T00:00:00Z" });
  assert.equal(allDayPosition(conference, "2026-10-30"), "Day 1 of 3");
  assert.equal(allDayPosition(conference, "2026-10-31"), "Day 2 of 3");
  assert.equal(allDayPosition(conference, "2026-11-01"), "Day 3 of 3");
  const spring = event({ allDay: true, startsAt: "2026-03-28T00:00:00Z", endsAt: "2026-03-31T00:00:00Z" });
  assert.equal(allDayPosition(spring, "2026-03-30"), "Day 3 of 3");
});

test("a one day all-day or a timed event has no position or span", () => {
  const one = event({ allDay: true, startsAt: "2026-11-04T00:00:00Z", endsAt: "2026-11-05T00:00:00Z" });
  assert.equal(allDayPosition(one, "2026-11-04"), null);
  assert.equal(allDaySpanText(one), null);
  assert.equal(allDayPosition(event({ startsAt: local(2026, 11, 4, 9) }), "2026-11-04"), null);
});

test("the span is written with the month once, or twice when the days cross a month", () => {
  assert.match(allDaySpanText(event({ allDay: true, startsAt: "2026-11-03T00:00:00Z", endsAt: "2026-11-06T00:00:00Z" }))!, /^3 to 5 November 2026$/);
  assert.match(allDaySpanText(event({ allDay: true, startsAt: "2026-10-30T00:00:00Z", endsAt: "2026-11-03T00:00:00Z" }))!, /^30 October to 2 November 2026$/);
});

test("the detail line joins when, where and who, and an all-day event starts with where", () => {
  const timed = event({ startsAt: local(2026, 11, 4, 9), endsAt: local(2026, 11, 4, 10), location: "Office", attendees: [{ name: "Sarah Lee", email: "s@x.com", contactId: null }] });
  assert.equal(eventDetail(timed), "09:00 to 10:00 · Office · Sarah Lee");
  assert.equal(eventDetail(event({ allDay: true, startsAt: "2026-11-04T00:00:00Z" })), "All Day");
  assert.equal(eventDetail(event({ allDay: true, startsAt: "2026-11-04T00:00:00Z", location: "Sandton" })), "Sandton");
  assert.equal(dayKey(new Date(timed.startsAt)), "2026-11-04");
});
