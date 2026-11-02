// Tests for sync-window.ts: when the Calendar page says a range is not synced.

import assert from "node:assert/strict";
import test from "node:test";
import { syncNotice } from "./sync-window";

const today = new Date(2026, 10, 2); // Monday 2 November 2026

test("a range inside the window has no notice", () => {
  assert.equal(syncNotice("2026-10-26", "2026-11-30", today, true), null);
  assert.equal(syncNotice("2027-10-01", "2027-11-02", today, false), null); // exactly a year ahead is synced
});

test("a range wholly past a year ahead is not synced", () => {
  assert.equal(syncNotice("2027-11-04", "2027-12-15", today, false)?.kind, "future");
  assert.equal(syncNotice("2027-11-04", "2027-12-15", today, false)!.title, "Not Synced");
});

test("a range that crosses the far edge says part of it is not synced", () => {
  const notice = syncNotice("2027-10-25", "2027-12-05", today, true);
  assert.equal(notice?.kind, "future");
  assert.equal(notice!.title, "Partly Not Synced");
});

test("far in the past warns only when nothing was found there", () => {
  assert.equal(syncNotice("2026-05-01", "2026-06-11", today, false)?.kind, "past");
  assert.equal(syncNotice("2026-05-01", "2026-06-11", today, true), null);
});

test("the day the past edge sits on still counts as synced", () => {
  // 90 days before 2 November 2026 is 4 August.
  assert.equal(syncNotice("2026-07-01", "2026-08-04", today, false), null);
  assert.equal(syncNotice("2026-07-01", "2026-08-03", today, false)?.kind, "past");
});
