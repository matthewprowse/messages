// Tests for runtime/state.ts dispatchOnce: a row is handed on at most once at a time, is released when the work ends
// or fails, and a row that fails to prepare does not stay held.

import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatching, dispatchOnce } from "./state";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a second hand-off of the same id is ignored while the first is in flight, then allowed again", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let started = 0;
  const prepare = async () => async () => { started++; await gate; };
  await dispatchOnce("row-a", prepare, () => assert.fail("no error expected"));
  await dispatchOnce("row-a", prepare, () => assert.fail("no error expected"));
  await tick();
  assert.equal(started, 1);
  assert.equal(dispatching.has("row-a"), true);
  release();
  await tick();
  assert.equal(dispatching.has("row-a"), false);
});

test("prepare returning null leaves the row for a later pass", async () => {
  await dispatchOnce("row-b", async () => null, () => assert.fail("no error expected"));
  assert.equal(dispatching.has("row-b"), false);
});

test("a prepare that throws and work that rejects both report the error and release the id", async () => {
  const errors: unknown[] = [];
  await dispatchOnce("row-c", async () => { throw new Error("prepare"); }, (e) => errors.push(e));
  assert.equal(dispatching.has("row-c"), false);
  await dispatchOnce("row-d", async () => async () => { throw new Error("work"); }, (e) => errors.push(e));
  await tick();
  assert.equal(dispatching.has("row-d"), false);
  assert.equal(errors.length, 2);
});
