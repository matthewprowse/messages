// Tests for the IMAP tick plan: slow with IDLE, a minute without, and the slower jobs keeping their wall-clock spacing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { imapPollPlan } from "./poll-plan";

test("with IDLE the tick is slow and the slower jobs run every tick or so", () => {
  assert.deepEqual(imapPollPlan(true, 300_000, 60_000), { tickMs: 300_000, reconcileEvery: 1, filesEvery: 2, selfEvery: 2 });
});

test("without IDLE the tick is a minute and the old tick counts apply", () => {
  assert.deepEqual(imapPollPlan(false, 300_000, 60_000), { tickMs: 60_000, reconcileEvery: 5, filesEvery: 10, selfEvery: 10 });
});

test("a tick longer than a job's spacing still runs that job every tick", () => {
  assert.equal(imapPollPlan(true, 3_600_000, 60_000).reconcileEvery, 1);
});
