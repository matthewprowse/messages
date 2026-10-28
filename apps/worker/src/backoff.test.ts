// Tests for backoff.ts: supervise restarts a run that rejects, waits between restarts, and stops once told to.

import assert from "node:assert/strict";
import { test } from "node:test";
import { supervise } from "./backoff";

test("supervise restarts a run that rejects, then returns when it finishes", async () => {
  let runs = 0;
  const errors: unknown[] = [];
  const waits: number[] = [];
  await supervise(
    async () => {
      if (++runs < 3) throw new Error("boom");
    },
    () => false,
    (e) => errors.push(e),
    async (ms) => void waits.push(ms),
  );
  assert.equal(runs, 3);
  assert.equal(errors.length, 2);
  assert.equal(waits.length, 2);
});

test("supervise does not restart once stopped", async () => {
  let runs = 0;
  let stopped = false;
  await supervise(
    async () => {
      runs++;
      stopped = true;
      throw new Error("boom");
    },
    () => stopped,
    () => undefined,
    async () => undefined,
  );
  assert.equal(runs, 1);
});
