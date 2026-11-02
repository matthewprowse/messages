// Tests for send-schedule.ts: the Undo Send window, the Send Later choices and how a scheduled time reads. Dates are built
// in local time, as the app does, so the results hold in any time zone.

import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_UNDO_SECONDS, combineDateTime, describeWhen, isScheduled, laterChoices, readUndoSeconds, scheduleError, sendAfterIso, undoSecondsFrom, writeUndoSeconds } from "./send-schedule";

const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0);
const hhmm = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;

test("the Undo window is one of the choices, and anything else means ten seconds", () => {
  assert.equal(undoSecondsFrom("0"), 0);
  assert.equal(undoSecondsFrom("30"), 30);
  assert.equal(undoSecondsFrom("7"), DEFAULT_UNDO_SECONDS);
  assert.equal(undoSecondsFrom(null), DEFAULT_UNDO_SECONDS);
  assert.equal(undoSecondsFrom(""), DEFAULT_UNDO_SECONDS);
});

test("the Undo window is kept in storage, and a blocked store falls back to the default", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  writeUndoSeconds(20, storage);
  assert.equal(readUndoSeconds(storage), 20);
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(readUndoSeconds(blocked), DEFAULT_UNDO_SECONDS);
  assert.doesNotThrow(() => writeUndoSeconds(5, blocked));
});

test("send_after is the window past now, or nothing when Undo is off", () => {
  const now = Date.parse("2026-11-18T10:00:00Z");
  assert.equal(sendAfterIso(10, now), "2026-11-18T10:00:10.000Z");
  assert.equal(sendAfterIso(0, now), null);
});

test("a row is scheduled only when its time is well past the Undo window", () => {
  assert.equal(isScheduled("2026-11-18T10:00:30Z", "2026-11-18T10:00:00Z"), false);
  assert.equal(isScheduled("2026-11-18T14:00:00Z", "2026-11-18T10:00:00Z"), true);
  assert.equal(isScheduled(null, "2026-11-18T10:00:00Z"), false);
  assert.equal(isScheduled("nonsense", "2026-11-18T10:00:00Z"), false);
});

test("on a Wednesday morning the choices are three hours on, 08:00 tomorrow and 08:00 on Monday", () => {
  const wed = local(2026, 11, 18, 9, 10); // 18 November 2026 is a Wednesday
  const c = laterChoices(wed);
  assert.deepEqual(c.map((x) => x.key), ["today", "tomorrow", "monday"]);
  assert.equal(hhmm(c[0].at), "12:30");
  assert.deepEqual([c[1].at.getDate(), hhmm(c[1].at)], [19, "8:00"]);
  assert.deepEqual([c[2].at.getDay(), c[2].at.getDate(), hhmm(c[2].at)], [1, 23, "8:00"]);
});

test("later today rounds up to the half hour and is left out once it would pass midnight", () => {
  assert.equal(hhmm(laterChoices(local(2026, 11, 18, 9, 0))[0].at), "12:00");
  assert.equal(hhmm(laterChoices(local(2026, 11, 18, 9, 40))[0].at), "13:00");
  assert.deepEqual(laterChoices(local(2026, 11, 18, 22, 0)).map((x) => x.key), ["tomorrow", "monday"]);
});

test("Monday is the next one, and is not listed twice when tomorrow is Monday", () => {
  const sun = laterChoices(local(2026, 11, 22, 9, 0)); // Sunday
  assert.deepEqual(sun.map((x) => x.key), ["today", "tomorrow"]);
  const mon = laterChoices(local(2026, 11, 23, 9, 0)); // Monday: next Monday is a week on
  assert.equal(mon.find((x) => x.key === "monday")?.at.getDate(), 30);
});

test("a time reads as Today, Tomorrow or a dated day, with the year only when it is not this one", () => {
  const now = local(2026, 11, 18, 9, 0);
  assert.equal(describeWhen(local(2026, 11, 18, 14, 30), now), "Today 14:30");
  assert.equal(describeWhen(local(2026, 11, 19, 8, 0), now), "Tomorrow 08:00");
  assert.equal(describeWhen(local(2026, 11, 23, 8, 0), now), "Mon 23 Nov 08:00");
  assert.equal(describeWhen(local(2027, 1, 4, 8, 0), now), "Mon 4 Jan 2027 08:00");
});

test("a picked day and time combine into one local time, and a bad time is refused", () => {
  const day = local(2026, 11, 25, 15, 45);
  const out = combineDateTime(day, "09:05");
  assert.deepEqual([out?.getDate(), out?.getHours(), out?.getMinutes()], [25, 9, 5]);
  assert.equal(combineDateTime(day, ""), null);
  assert.equal(combineDateTime(day, "25:00"), null);
  assert.equal(combineDateTime(undefined, "09:00"), null);
});

test("a chosen time must be in the future and within a year", () => {
  const now = local(2026, 11, 18, 9, 0);
  assert.equal(scheduleError(null, now), "Choose a day and a time.");
  assert.equal(scheduleError(local(2026, 11, 18, 9, 0), now), "Choose a time in the future.");
  assert.equal(scheduleError(local(2026, 11, 18, 10, 0), now), null);
  assert.equal(scheduleError(local(2028, 1, 1, 10, 0), now), "Choose a time within the next year.");
});
