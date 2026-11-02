// Tests for sync-plan.ts: only changed documents are sent, and only ones the plan itself sent earlier are removed.

import test from "node:test";
import assert from "node:assert/strict";
import { docId } from "./engine";
import { planSync } from "./sync-plan";
import type { Doc } from "./types";

const task = (ref: string, t = "Task"): Doc => ({ id: docId("task", ref), k: "task", r: ref, t, x: "", at: 0 });

test("the first list sends everything", () => {
  const plan = planSync(new Map(), [task("a"), task("b")]);
  assert.equal(plan.upserts.length, 2);
  assert.deepEqual(plan.removed, []);
});

test("an unchanged list sends nothing", () => {
  const first = planSync(new Map(), [task("a"), task("b")]);
  const again = planSync(first.state, [task("a"), task("b")]);
  assert.deepEqual(again.upserts, []);
  assert.deepEqual(again.removed, []);
});

test("a changed document is sent again, a new one is sent, a vanished one is removed", () => {
  const first = planSync(new Map(), [task("a"), task("b")]);
  const next = planSync(first.state, [task("a", "Renamed"), task("c")]);
  assert.deepEqual(next.upserts.map((d) => d.r), ["a", "c"]);
  assert.deepEqual(next.removed, [docId("task", "b")]);
  assert.deepEqual([...next.state.keys()].sort(), [docId("task", "a"), docId("task", "c")].sort());
});
