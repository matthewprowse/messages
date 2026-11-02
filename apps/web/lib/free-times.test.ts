// Tests for free-times.ts: gaps in working hours between events, across time zones, clock changes, all-day events and
// today, and the text offered to a client.

import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_HOURS, clockIn, dayInZone, formatFreeTimes, freeSlotsOn, freeTimes, instantAt, minutesOf, nextWorkingDays, readHours, timeOfMinutes, workingDaysBetween, writeHours, type Busy } from "./free-times";

const SAST = "Africa/Johannesburg"; // UTC+2 all year
const timed = (startsAt: string, endsAt: string): Busy => ({ startsAt, endsAt, allDay: false });
const clock = (slots: { start: Date; end: Date }[], tz = SAST) => slots.map((s) => `${clockIn(s.start, tz)}-${clockIn(s.end, tz)}`);
// Wednesday 4 November 2026, 06:00 in Johannesburg: before working hours begin.
const earlyWednesday = new Date("2026-11-04T04:00:00Z");

test("a wall clock is turned into the right instant in zones with and without clock changes", () => {
  assert.equal(new Date(instantAt("2026-11-05", 8 * 60, SAST)).toISOString(), "2026-11-05T06:00:00.000Z");
  // New York leaves summer time at 02:00 on 1 November 2026: 08:00 is UTC-4 the day before, UTC-5 on the day.
  assert.equal(new Date(instantAt("2026-10-31", 8 * 60, "America/New_York")).toISOString(), "2026-10-31T12:00:00.000Z");
  assert.equal(new Date(instantAt("2026-11-01", 8 * 60, "America/New_York")).toISOString(), "2026-11-01T13:00:00.000Z");
  assert.equal(dayInZone(new Date("2026-11-04T23:30:00Z"), SAST), "2026-11-05");
  assert.equal(dayInZone(new Date("2026-11-04T23:30:00Z"), "America/New_York"), "2026-11-04");
});

test("the gaps between events inside working hours are free, on the quarter hour", () => {
  const busy = [timed("2026-11-05T07:00:00Z", "2026-11-05T08:00:00Z"), timed("2026-11-05T10:00:00Z", "2026-11-05T11:20:00Z")]; // 09:00-10:00 and 12:00-13:20
  const slots = freeSlotsOn("2026-11-05", busy, { hours: DEFAULT_HOURS, timeZone: SAST, now: earlyWednesday, minMinutes: 30 });
  assert.deepEqual(clock(slots), ["08:00-09:00", "10:00-12:00", "13:30-17:00"]); // 13:20 is rounded up to 13:30
});

test("an event that overlaps another, or runs past working hours, does not open a false gap", () => {
  const busy = [timed("2026-11-05T06:00:00Z", "2026-11-05T09:00:00Z"), timed("2026-11-05T07:00:00Z", "2026-11-05T08:00:00Z"), timed("2026-11-05T14:00:00Z", "2026-11-05T18:00:00Z")];
  assert.deepEqual(clock(freeSlotsOn("2026-11-05", busy, { hours: DEFAULT_HOURS, timeZone: SAST, now: earlyWednesday, minMinutes: 30 })), ["11:00-16:00"]);
});

test("a gap shorter than the minimum is left out", () => {
  const busy = [timed("2026-11-05T06:00:00Z", "2026-11-05T06:50:00Z"), timed("2026-11-05T07:20:00Z", "2026-11-05T15:00:00Z")]; // 08:00-08:50, 09:20-17:00
  assert.deepEqual(clock(freeSlotsOn("2026-11-05", busy, { hours: DEFAULT_HOURS, timeZone: SAST, now: earlyWednesday, minMinutes: 30 })), []);
  assert.deepEqual(clock(freeSlotsOn("2026-11-05", busy, { hours: DEFAULT_HOURS, timeZone: SAST, now: earlyWednesday, minMinutes: 15 })), ["09:00-09:15"]);
});

test("the same event takes different hours of the day in different zones", () => {
  const busy = [timed("2026-11-05T13:00:00Z", "2026-11-05T14:00:00Z")]; // 15:00-16:00 in Johannesburg, 08:00-09:00 in New York (UTC-5 after the clock change)
  const joburg = freeSlotsOn("2026-11-05", busy, { hours: DEFAULT_HOURS, timeZone: SAST, now: earlyWednesday, minMinutes: 30 });
  const newYork = freeSlotsOn("2026-11-05", busy, { hours: DEFAULT_HOURS, timeZone: "America/New_York", now: earlyWednesday, minMinutes: 30 });
  assert.deepEqual(clock(joburg), ["08:00-15:00", "16:00-17:00"]);
  assert.deepEqual(clock(newYork, "America/New_York"), ["09:00-17:00"]);
});

test("today starts at the next quarter hour, and nothing is offered once working hours are over", () => {
  const now = new Date("2026-11-04T08:07:00Z"); // 10:07 in Johannesburg
  assert.deepEqual(clock(freeSlotsOn("2026-11-04", [], { hours: DEFAULT_HOURS, timeZone: SAST, now, minMinutes: 30 })), ["10:15-17:00"]);
  assert.deepEqual(freeSlotsOn("2026-11-04", [], { hours: DEFAULT_HOURS, timeZone: SAST, now: new Date("2026-11-04T15:30:00Z"), minMinutes: 30 }), []);
});

test("an all-day event does not block time, but one over several days does", () => {
  const birthday: Busy = { startsAt: "2026-11-05T00:00:00Z", endsAt: "2026-11-06T00:00:00Z", allDay: true };
  const leave: Busy = { startsAt: "2026-11-05T00:00:00Z", endsAt: "2026-11-07T00:00:00Z", allDay: true }; // 5th and 6th; the 7th is not included
  const opts = { hours: DEFAULT_HOURS, timeZone: SAST, now: earlyWednesday, minMinutes: 30 };
  assert.deepEqual(clock(freeSlotsOn("2026-11-05", [birthday], opts)), ["08:00-17:00"]);
  assert.deepEqual(freeSlotsOn("2026-11-05", [leave], opts), []);
  assert.deepEqual(freeSlotsOn("2026-11-06", [leave], opts), []);
  assert.deepEqual(clock(freeSlotsOn("2026-11-07", [leave], opts)), ["08:00-17:00"]);
});

test("the next working days skip the weekend, and today only counts while working hours remain", () => {
  const friday = new Date("2026-11-06T05:00:00Z"); // 07:00 Friday in Johannesburg
  assert.deepEqual(nextWorkingDays(friday, 3, DEFAULT_HOURS, SAST), ["2026-11-06", "2026-11-09", "2026-11-10"]);
  const fridayEvening = new Date("2026-11-06T16:00:00Z");
  assert.deepEqual(nextWorkingDays(fridayEvening, 2, DEFAULT_HOURS, SAST), ["2026-11-09", "2026-11-10"]);
  assert.deepEqual(workingDaysBetween("2026-11-06", "2026-11-10"), ["2026-11-06", "2026-11-09", "2026-11-10"]);
});

test("the text names each slot's day, keeps a day's longest gaps in time order, and adds the date beyond a week", () => {
  const now = earlyWednesday;
  const busy = [timed("2026-11-05T07:00:00Z", "2026-11-05T08:00:00Z")]; // Thursday 09:00-10:00 busy
  const days = freeTimes(["2026-11-05", "2026-11-06"], [...busy, timed("2026-11-06T06:00:00Z", "2026-11-06T13:30:00Z")], { timeZone: SAST, now });
  assert.equal(formatFreeTimes(days, SAST, now), "Thursday 08:00 to 09:00, Thursday 10:00 to 17:00, Friday 15:30 to 17:00");
  const later = freeTimes(["2026-11-16"], [], { timeZone: SAST, now });
  assert.equal(formatFreeTimes(later, SAST, now), "Monday 16 November 08:00 to 17:00");
  assert.equal(formatFreeTimes([], SAST, now), "");
});

test("a day keeps at most its three longest gaps", () => {
  const busy = [1, 2, 3, 4].map((i) => timed(`2026-11-05T${String(6 + i * 2).padStart(2, "0")}:00:00Z`, `2026-11-05T${String(6 + i * 2).padStart(2, "0")}:30:00Z`)); // 10:00, 12:00, 14:00, 16:00 SAST for half an hour
  const days = freeTimes(["2026-11-05"], busy, { timeZone: SAST, now: earlyWednesday });
  assert.equal(days[0].slots.length, 5);
  assert.equal(formatFreeTimes(days, SAST, earlyWednesday).split(", ").length, 3);
});

test("working hours are remembered, and nonsense or a blocked storage gives the default", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  assert.deepEqual(readHours(storage), DEFAULT_HOURS);
  writeHours(storage, { start: 9 * 60, end: 16 * 60 });
  assert.deepEqual(readHours(storage), { start: 540, end: 960 });
  writeHours(storage, { start: 900, end: 600 });
  assert.deepEqual(readHours(storage), DEFAULT_HOURS);
  assert.deepEqual(readHours({ getItem: () => { throw new Error("blocked"); }, setItem: () => undefined }), DEFAULT_HOURS);
  assert.deepEqual(readHours(null), DEFAULT_HOURS);
  assert.equal(minutesOf("09:30"), 570);
  assert.equal(minutesOf("25:00"), null);
  assert.equal(timeOfMinutes(570), "09:30");
});
