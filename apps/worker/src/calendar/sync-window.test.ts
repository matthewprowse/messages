// Tests for calendar/sync-window.ts: the dates of the whole and the near window, and when the whole one is due.

import assert from "node:assert/strict";
import test from "node:test";
import { FULL_EVERY_MS, fullFetchDue, syncWindow } from "./sync-window";

const NOW = Date.UTC(2026, 10, 2, 8, 0, 0); // Monday 2 November 2026, 08:00 UTC

test("the whole window reaches 90 days back and 365 ahead", () => {
  const w = syncWindow(NOW);
  assert.equal(w.timeMin, "2026-08-04T08:00:00.000Z");
  assert.equal(w.timeMax, "2027-11-02T08:00:00.000Z");
});

test("the near window is a week back and 60 days ahead", () => {
  const w = syncWindow(NOW, "near");
  assert.equal(w.timeMin, "2026-10-26T08:00:00.000Z");
  assert.equal(w.timeMax, "2027-01-01T08:00:00.000Z");
});

test("the near window sits inside the whole one", () => {
  const whole = syncWindow(NOW);
  const near = syncWindow(NOW, "near");
  assert.ok(near.timeMin > whole.timeMin && near.timeMax < whole.timeMax);
});

test("the whole window is due on the first poll and again after an hour", () => {
  assert.equal(fullFetchDue(NOW, null), true);
  assert.equal(fullFetchDue(NOW + FULL_EVERY_MS - 1, NOW), false);
  assert.equal(fullFetchDue(NOW + FULL_EVERY_MS, NOW), true);
});
