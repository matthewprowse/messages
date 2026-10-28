// Tests for how a Realtime reconnect decides what to catch up on.

import assert from "node:assert/strict";
import { test } from "node:test";
import { changesSince, CLOCK_MARGIN_MS, FULL_OVER_MS, resyncPlan, SKIP_UNDER_MS } from "./app-store/resync-plan";

test("a short drop is skipped, a medium one is caught up, a long one reloads everything", () => {
  assert.equal(resyncPlan(0), "skip");
  assert.equal(resyncPlan(SKIP_UNDER_MS - 1), "skip");
  assert.equal(resyncPlan(SKIP_UNDER_MS), "delta");
  assert.equal(resyncPlan(FULL_OVER_MS), "delta");
  assert.equal(resyncPlan(FULL_OVER_MS + 1), "full");
});

test("a catch-up reaches back past the drop by the clock margin", () => {
  assert.equal(changesSince(Date.parse("2026-10-28T12:00:00.000Z")), new Date(Date.parse("2026-10-28T12:00:00.000Z") - CLOCK_MARGIN_MS).toISOString());
});
