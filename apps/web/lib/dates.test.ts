// Pins down lib/dates.ts: day keys, strict parsing, day arithmetic across month ends and daylight saving, time choices.

import assert from "node:assert/strict";
import test from "node:test";

import { addDays, dayKey, fromDateKey, fromKey, pad, parseKey, shiftKey, startOfMonth, startOfWeek, timeChoices, timeKey } from "./dates";

test("a day key is zero padded and local", () => {
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  assert.equal(timeKey(new Date(2026, 0, 5, 7, 5)), "07:05");
  assert.equal(pad(3), "03");
});

test("fromKey and fromDateKey read a local midnight, and fromDateKey refuses other shapes", () => {
  assert.equal(fromKey("2026-03-09").getHours(), 0);
  assert.equal(fromDateKey("2026-03-09")?.getDate(), 9);
  assert.equal(fromDateKey("2026-3-9"), undefined);
  assert.equal(fromDateKey(""), undefined);
});

test("parseKey refuses a day that does not exist instead of rolling it over", () => {
  assert.equal(parseKey("2026-02-31"), undefined);
  assert.equal(parseKey(null), undefined);
  assert.equal(dayKey(parseKey("2028-02-29")!), "2028-02-29");
});

test("addDays and shiftKey cross month and year ends", () => {
  assert.equal(dayKey(addDays(new Date(2026, 11, 31), 1)), "2027-01-01");
  assert.equal(dayKey(addDays(new Date(2026, 2, 1), -1)), "2026-02-28");
  assert.equal(shiftKey("2026-10-31", 1), "2026-11-01");
  assert.equal(shiftKey("2026-11-01", -2), "2026-10-30");
});

test("addDays keeps whole calendar days when the clocks change", () => {
  // March 2026 is the northern spring change: a 23 hour day must still be one day.
  assert.equal(dayKey(addDays(new Date(2026, 2, 28), 2)), "2026-03-30");
  assert.equal(dayKey(addDays(new Date(2026, 9, 24), 3)), "2026-10-27");
});

test("weeks start on Monday and months on the first", () => {
  assert.equal(dayKey(startOfWeek(new Date(2026, 10, 1))), "2026-10-26"); // a Sunday
  assert.equal(dayKey(startOfWeek(new Date(2026, 10, 2))), "2026-11-02"); // a Monday
  assert.equal(dayKey(startOfMonth(new Date(2026, 10, 19))), "2026-11-01");
});

test("time choices are a quarter hour apart and keep an odd time already set", () => {
  assert.equal(timeChoices("").length, 96);
  assert.ok(timeChoices("09:10").includes("09:10"));
  assert.equal(timeChoices("09:15").length, 96);
  assert.equal(timeChoices("", 30).length, 48);
});
