// Tests for storage-sweep-plan.ts: an object some attachment row still points at is never removed, only forgotten.

import { test } from "node:test";
import assert from "node:assert/strict";
import { gaveUp, planSweep } from "./storage-sweep-plan";

const q = (id: string, path: string, attempts = 0) => ({ id, path, attempts });

test("a path no row points at is removed, one still referenced is only forgotten", () => {
  const plan = planSweep([q("1", "u/a"), q("2", "u/b"), q("3", "u/c")], new Set(["u/b"]));
  assert.deepEqual(plan.remove.map((x) => x.id), ["1", "3"]);
  assert.deepEqual(plan.forget.map((x) => x.id), ["2"]);
});

test("an empty queue plans nothing", () => {
  assert.deepEqual(planSweep([], new Set()), { remove: [], forget: [] });
});

test("five failed tries give up", () => {
  assert.equal(gaveUp(q("1", "x", 4)), false);
  assert.equal(gaveUp(q("1", "x", 5)), true);
});
