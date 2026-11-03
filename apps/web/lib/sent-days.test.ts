// Tests for the sent-messages heatmap grid.

import assert from "node:assert/strict";
import test from "node:test";
import { greeting, gridStart, sentTotal, sentWeeks } from "./sent-days";

// Wednesday 4 November 2026, local time.
const TODAY = new Date(2026, 10, 4, 15);

test("the grid starts on a Monday and ends with this week", () => {
  const start = gridStart(TODAY, 2);
  assert.equal(start.getDay(), 1);
  assert.equal(start.getDate(), 26); // Monday 26 October
  const weeks = sentWeeks([], TODAY, 2);
  assert.equal(weeks.length, 2);
  assert.equal(weeks[1][0].date, "2026-11-02");
  assert.equal(weeks[1][6].date, "2026-11-08");
});

test("days after today are marked future and count nothing", () => {
  const weeks = sentWeeks([new Date(2026, 10, 6, 9).toISOString()], TODAY, 1);
  assert.deepEqual(weeks[0].map((d) => d.future), [false, false, false, true, true, true, true]);
  assert.equal(sentTotal(weeks), 0);
});

test("counts land on their local day and shade by the busiest day", () => {
  const at = (d: number, h: number) => new Date(2026, 10, d, h).toISOString();
  const weeks = sentWeeks([at(2, 9), at(2, 10), at(2, 11), at(2, 12), at(3, 8), at(4, 23)], TODAY, 1);
  assert.deepEqual(weeks[0].slice(0, 3).map((d) => [d.count, d.level]), [[4, 4], [1, 1], [1, 1]]);
  assert.equal(weeks[0][3].level, 0);
  assert.equal(sentTotal(weeks), 6);
});

test("sends before the grid are ignored", () => {
  assert.equal(sentTotal(sentWeeks([new Date(2026, 0, 1).toISOString()], TODAY, 4)), 0);
});

test("the greeting follows the time of day and uses the first name", () => {
  assert.equal(greeting(new Date(2026, 10, 4, 9), "Matthew Prowse"), "Good Morning, Matthew");
  assert.equal(greeting(new Date(2026, 10, 4, 12), "Matthew"), "Good Afternoon, Matthew");
  assert.equal(greeting(new Date(2026, 10, 4, 18), "  "), "Good Evening");
});
