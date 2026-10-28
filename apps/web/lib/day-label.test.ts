// Tests for dayLabel in format.ts: Today, Yesterday, weekday names for the past week, then full dates.

import { test } from "node:test";
import assert from "node:assert/strict";
import { dayLabel } from "./format";

const now = new Date(2026, 9, 23, 15, 0); // Friday 23 October 2026

test("dayLabel names today, yesterday and the rest of the past week by weekday", () => {
  assert.equal(dayLabel(new Date(2026, 9, 23, 9, 0).toISOString(), now), "Today");
  assert.equal(dayLabel(new Date(2026, 9, 22, 9, 0).toISOString(), now), "Yesterday");
  assert.equal(dayLabel(new Date(2026, 9, 21, 9, 0).toISOString(), now), "Wednesday");
  assert.equal(dayLabel(new Date(2026, 9, 17, 9, 0).toISOString(), now), "Saturday");
});

test("dayLabel gives older days their date, and the year when it is not this year", () => {
  assert.equal(dayLabel(new Date(2026, 9, 16, 9, 0).toISOString(), now), "Friday, 16 October");
  assert.equal(dayLabel(new Date(2025, 11, 31, 9, 0).toISOString(), now), "Wednesday, 31 December 2025");
});
