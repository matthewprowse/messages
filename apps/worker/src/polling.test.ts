// Tests for polling.ts: the poll delay as activity fades, the heartbeat gate, and the exponential file retry delay that ends in giving up.

import assert from "node:assert/strict";
import { test } from "node:test";
import { AccountActivity, fileRetryDelay, GMAIL_POLL, HeartbeatGate, nextPollDelay, OUTLOOK_SIDE_POLL, QUEUE_POLL, TEAMS_POLL, type PollPlan } from "./polling";

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

test("each account backs off on its own: a busy mailbox does not keep a quiet one fast", () => {
  const acts = new AccountActivity();
  acts.mark("busy", 3_000_000);
  acts.mark("quiet", 0);
  const now = 3_000_001;
  assert.equal(acts.delay("busy", plan, now), 5_000);
  assert.equal(acts.delay("quiet", plan, now), 30_000);
  assert.equal(acts.delay("quiet", plan, 3_700_000), 60_000);
});

test("an account never seen counts as active, and a mark snaps it back to fast", () => {
  const acts = new AccountActivity();
  assert.equal(acts.delay("new", plan, 9_000_000), 5_000);
  acts.mark("a", 0);
  assert.equal(acts.delay("a", plan, 4_000_000), 60_000);
  acts.mark("a", 3_999_000); // the app sent a reply for this account
  assert.equal(acts.delay("a", plan, 4_000_000), 5_000);
});

test("a mark wakes only that account's listeners, and stopping the listener removes it", () => {
  const acts = new AccountActivity();
  let a = 0;
  let b = 0;
  const stopA = acts.onMark("a", () => a++);
  acts.onMark("b", () => b++);
  acts.mark("a");
  acts.mark("a");
  assert.deepEqual([a, b], [2, 0]);
  stopA();
  acts.mark("a");
  assert.equal(a, 2);
});

test("a forgotten account starts active again", () => {
  const acts = new AccountActivity();
  acts.mark("a", 0);
  acts.forget("a");
  assert.equal(acts.delay("a", plan, 9_000_000), 5_000);
});

test("the real plans: mail 5 s to 60 s, Outlook side folders 20 s to 5 min, Teams 15 s to 60 s, queue 60 s to 5 min", () => {
  const hour = 60 * 60_000;
  const at = (p: PollPlan) => [nextPollDelay(1, 0, p), nextPollDelay(11 * 60_000, 0, p), nextPollDelay(hour + 1, 0, p)];
  assert.deepEqual(at(GMAIL_POLL), [5_000, 30_000, 60_000]);
  assert.deepEqual(at(OUTLOOK_SIDE_POLL), [20_000, 120_000, 300_000]);
  assert.deepEqual(at(TEAMS_POLL), [15_000, 30_000, 60_000]);
  assert.deepEqual(at(QUEUE_POLL), [60_000, 300_000, 300_000]);
});
