// settle.ts: a claimed Reminders change is waited on until the AI worker settles it, and failed plainly when it never is.

import assert from "node:assert/strict";
import { test } from "node:test";
import { TaskUpdateError } from "./rows";
import { NOT_ANSWERED, waitUntilSettled } from "./settle";

function clock() {
  let t = 0;
  return { now: () => t, wait: async (ms: number) => { t += ms; } };
}

test("waits while the change is under way and returns once it is settled", async () => {
  const statuses = ["updating", "updating", "done"];
  let reads = 0;
  const { now, wait } = clock();
  await waitUntilSettled(async () => (reads++, statuses.shift() ?? "done"), { now, wait, pollMs: 1000, timeoutMs: 60_000 });
  assert.equal(reads, 3);
});

test("a change the AI worker failed, or one that is gone, counts as settled", async () => {
  for (const status of ["failed", null]) {
    const { now, wait } = clock();
    await waitUntilSettled(async () => status, { now, wait });
  }
});

test("a change nobody settles fails with a reason the app can show", async () => {
  const { now, wait } = clock();
  await assert.rejects(
    waitUntilSettled(async () => "updating", { now, wait, pollMs: 1000, timeoutMs: 5000 }),
    (err) => err instanceof TaskUpdateError && err.message === NOT_ANSWERED,
  );
});
