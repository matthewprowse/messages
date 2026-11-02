// Tests for the mail check cadence: slow when push is healthy, the old activity based cadence when it is off or failing.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { PollPlan } from "../polling";
import { mailPollDelay } from "./mail-poll";

const plan: PollPlan = { activeMs: 5_000, idleMs: 30_000, deepIdleMs: 60_000, activeWindowMs: 600_000, deepIdleAfterMs: 3_600_000 };
const SLOW = 300_000;

test("with push working, the check is the slow one whatever the activity", () => {
  assert.equal(mailPollDelay("healthy", plan, 1_000, 1_000, SLOW), SLOW);
  assert.equal(mailPollDelay("healthy", plan, 0, 10_000_000, SLOW), SLOW);
});

test("without push the old cadence stays, so nothing gets slower before push is set up", () => {
  assert.equal(mailPollDelay("off", plan, 1_000, 2_000, SLOW), 5_000);
  assert.equal(mailPollDelay("off", plan, 0, 4_000_000, SLOW), 60_000);
});

test("with push failing the old cadence returns: fast while active, slower as it goes quiet", () => {
  assert.equal(mailPollDelay("failing", plan, 1_000, 2_000, SLOW), 5_000);
  assert.equal(mailPollDelay("failing", plan, 0, 700_000, SLOW), 30_000);
  assert.equal(mailPollDelay("failing", plan, 0, 4_000_000, SLOW), 60_000);
});
