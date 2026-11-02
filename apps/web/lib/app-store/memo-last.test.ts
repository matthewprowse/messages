// Tests for the store's small caches: reuse while the input is the same, recompute when it changes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { memoLast, perSource } from "./memo-last";

test("memoLast reuses the result for the same input and recomputes for a new one", () => {
  let calls = 0;
  const f = memoLast((a: number[]) => { calls++; return a.length; });
  const x = [1, 2];
  assert.equal(f(x), 2);
  assert.equal(f(x), 2);
  assert.equal(calls, 1);
  assert.equal(f([1]), 1);
  assert.equal(calls, 2);
});

test("perSource caches per key until the source changes, and skips uncacheable keys", () => {
  let calls = 0;
  const f = perSource((s: number[], k: string) => { calls++; return `${k}:${s.length}`; });
  const a = [1];
  assert.equal(f(a, "x"), "x:1");
  assert.equal(f(a, "x"), "x:1");
  assert.equal(f(a, "y"), "y:1");
  assert.equal(calls, 2);
  f(a, "z", false);
  f(a, "z", false);
  assert.equal(calls, 4);
  assert.equal(f([1, 2], "x"), "x:2");
  assert.equal(calls, 5);
});
