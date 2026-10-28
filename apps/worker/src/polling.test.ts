// Tests for polling.ts: the poll delay as activity fades, the heartbeat gate, and the exponential file retry delay that ends in giving up.

import assert from "node:assert/strict";
import { test } from "node:test";
import { fileRetryDelay, HeartbeatGate, nextPollDelay, type PollPlan } from "./polling";

const plan: PollPlan = { activeMs: 5_000, idleMs: 30_000, deepIdleMs: 60_000, activeWindowMs: 600_000, deepIdleAfterMs: 3_600_000 };

test("polls fast while active, slower when quiet, slowest when long idle", () => {
  assert.equal(nextPollDelay(1_000, 1_000, plan), 5_000);
  assert.equal(nextPollDelay(599_999, 0, plan), 5_000);
  assert.equal(nextPollDelay(600_000, 0, plan), 30_000);
  assert.equal(nextPollDelay(3_599_999, 0, plan), 30_000);
  assert.equal(nextPollDelay(3_600_000, 0, plan), 60_000);
});

test("new activity snaps the delay back to the fast one", () => {
  const quietSince = 0;
  assert.equal(nextPollDelay(4_000_000, quietSince, plan), 60_000);
  assert.equal(nextPollDelay(4_000_000, 3_999_000, plan), 5_000);
});

test("the heartbeat is written once, then only after the interval", () => {
  const gate = new HeartbeatGate(15 * 60_000);
  assert.equal(gate.due("a", 0), true);
  assert.equal(gate.due("a", 60_000), false);
  assert.equal(gate.due("a", 14 * 60_000), false);
  assert.equal(gate.due("b", 60_000), true); // each account has its own
  assert.equal(gate.due("a", 15 * 60_000), true);
  assert.equal(gate.due("a", 16 * 60_000), false);
});

test("a status write counts as a heartbeat, and a failed write is retried at once", () => {
  const gate = new HeartbeatGate(15 * 60_000);
  gate.wrote("a", 0);
  assert.equal(gate.due("a", 60_000), false);
  gate.forget("a");
  assert.equal(gate.due("a", 60_000), true);
});

test("file retries back off exponentially and then give up", () => {
  assert.equal(fileRetryDelay(1, 6, 600_000), 600_000);
  assert.equal(fileRetryDelay(2, 6, 600_000), 1_200_000);
  assert.equal(fileRetryDelay(3, 6, 600_000), 2_400_000);
  assert.equal(fileRetryDelay(5, 6, 600_000), 9_600_000);
  assert.equal(fileRetryDelay(6, 6, 600_000), null);
});
