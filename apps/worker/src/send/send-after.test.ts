// Tests for send-after.ts: which outbox rows are due, and the filter the claim and the poll put on their queries.

import assert from "node:assert/strict";
import { test } from "node:test";
import { dueFilter, isDue, msUntilDue, waitingSince } from "./send-after";

const now = Date.parse("2026-11-18T10:00:00Z");

test("a row with no send_after is due, and so is one whose time has passed", () => {
  assert.equal(isDue(null, now), true);
  assert.equal(isDue(undefined, now), true);
  assert.equal(isDue("2026-11-18T10:00:00Z", now), true);
  assert.equal(isDue("2026-11-18T09:59:59Z", now), true);
});

test("a row waiting for its time is not due, and says how long is left", () => {
  assert.equal(isDue("2026-11-18T10:00:10Z", now), false);
  assert.equal(msUntilDue("2026-11-18T10:00:10Z", now), 10_000);
  assert.equal(msUntilDue(null, now), 0);
});

test("an unreadable time never strands a message", () => {
  assert.equal(isDue("tomorrow", now), true);
});

test("the claim filter keeps rows with no time and rows already due, and drops the rest", () => {
  const f = dueFilter(now);
  assert.equal(f, "send_after.is.null,send_after.lte.2026-11-18T10:00:00.000Z");
  // PostgREST splits an or filter on commas, so the value itself must not contain one.
  assert.equal(f.split(",").length, 2);
});

test("a scheduled row waits for a broken account from when it became due", () => {
  assert.equal(waitingSince({ created_at: "2026-11-17T10:00:00Z", send_after: "2026-11-18T08:00:00Z" }), "2026-11-18T08:00:00Z");
  assert.equal(waitingSince({ created_at: "2026-11-17T10:00:00Z", send_after: null }), "2026-11-17T10:00:00Z");
  assert.equal(waitingSince({ created_at: "2026-11-17T10:00:00Z", send_after: "2026-11-17T09:00:00Z" }), "2026-11-17T10:00:00Z");
});
