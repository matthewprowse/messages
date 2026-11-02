// Tests for run-pooled.ts: the concurrency cap and that one failing job does not stop the rest.

import assert from "node:assert/strict";
import { test } from "node:test";
import { runPooled } from "./run-pooled";

test("never more than the limit run at once, and all of them run", async () => {
  let running = 0, peak = 0, done = 0;
  const jobs = Array.from({ length: 20 }, () => async () => {
    running++; peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 2));
    running--; done++;
  });
  await runPooled(jobs, 6);
  assert.equal(done, 20);
  assert.ok(peak <= 6 && peak > 1);
});

test("a job that throws leaves the others running", async () => {
  let done = 0;
  await runPooled([async () => { throw new Error("x"); }, async () => { done++; }, () => { done++; }], 2);
  assert.equal(done, 2);
});

test("no jobs is fine", async () => {
  await runPooled([], 4);
});
