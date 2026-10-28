// Tests for the contact linker's change gate: first run takes everyone, an idle run takes no one, a changed user is
// run, and the refresh and full runs still happen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { changedSince, FULL_MS, newGate, pickUsers, REFRESH_MS, SKEW_MS } from "./dirty";

const users = ["a", "b", "c"];
const T = 1_000_000_000_000;

test("the first run covers everyone and later checks look from the last check", () => {
  const gate = newGate();
  assert.equal(changedSince(gate, T), null);
  assert.deepEqual(pickUsers(gate, users, "all", T), users);
  assert.equal(changedSince(gate, T + 15 * 60_000), new Date(T - SKEW_MS).toISOString());
});

test("an idle run takes no one, a changed user is taken", () => {
  const gate = newGate();
  pickUsers(gate, users, "all", T);
  assert.deepEqual(pickUsers(gate, users, new Set(), T + 15 * 60_000), []);
  assert.deepEqual(pickUsers(gate, users, new Set(["b"]), T + 30 * 60_000), ["b"]);
});

test("everyone is run again after the refresh time, and fully after a day", () => {
  const gate = newGate();
  pickUsers(gate, users, "all", T);
  pickUsers(gate, users, new Set(["a"]), T + 60_000);
  assert.deepEqual(pickUsers(gate, users, new Set(), T + REFRESH_MS + 30_000), ["b", "c"]);
  assert.equal(changedSince(gate, T + FULL_MS), null);
  assert.deepEqual(pickUsers(gate, users, new Set(), T + FULL_MS), users);
});

test("a user who left is forgotten and a new one is run at once", () => {
  const gate = newGate();
  pickUsers(gate, users, "all", T);
  assert.deepEqual(pickUsers(gate, ["a", "d"], new Set(), T + 60_000), ["d"]);
  assert.equal(gate.lastRun.has("b"), false);
});
