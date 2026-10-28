// Tests for mapLimit in util.ts: bounded concurrency with results kept in input order.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mapLimit } from "./util";

test("maps with bounded concurrency and keeps the order", async () => {
  let running = 0;
  let most = 0;
  const out = await mapLimit([5, 1, 4, 2, 3, 0], 2, async (n) => {
    running++;
    most = Math.max(most, running);
    await new Promise((resolve) => setTimeout(resolve, n));
    running--;
    return n * 10;
  });
  assert.deepEqual(out, [50, 10, 40, 20, 30, 0]);
  assert.equal(most, 2);
  assert.deepEqual(await mapLimit([], 3, async (n: number) => n), []);
});
