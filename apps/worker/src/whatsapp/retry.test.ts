// Tests for whatsapp/retry.ts: a transient failure is retried with a doubling wait, and the retry is bounded.

import { test } from "node:test";
import assert from "node:assert/strict";
import { retryStore } from "./retry";

test("a step that fails twice then works returns its value after waiting 500 and 1000 ms", async () => {
  let calls = 0;
  const waits: number[] = [];
  const value = await retryStore(async () => (++calls < 3 ? Promise.reject(new Error("db")) : "ok"), async (ms) => void waits.push(ms));
  assert.equal(value, "ok");
  assert.deepEqual(waits, [500, 1000]);
});

test("a step that always fails is tried the bounded number of times and throws the last error", async () => {
  let calls = 0;
  await assert.rejects(() => retryStore(async () => Promise.reject(new Error(`e${++calls}`)), async () => undefined, 3), /e3/);
  assert.equal(calls, 3);
});

test("a step that works first time never waits", async () => {
  const waits: number[] = [];
  assert.equal(await retryStore(async () => 1, async (ms) => void waits.push(ms)), 1);
  assert.deepEqual(waits, []);
});
