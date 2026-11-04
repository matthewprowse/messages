// rekey/plan.ts: the order of a rotation (prepare, wait for caches, switch, re-seal, retire only after a clean pass well
// after the switch), rows that disagree block, and a pass resumes from its saved cursor.

import assert from "node:assert/strict";
import { test } from "node:test";
import { GRACE_MS, nextStep, passIsClean, resumeCursor, TURNOVER_MS, type RotationRow } from "./plan";

const T0 = Date.parse("2026-11-04T10:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const key = { next_wrapped_key: null, previous_wrapped_key: null };

test("a user with no rotation is prepared when asked to start, and only reported otherwise", () => {
  assert.deepEqual(nextStep(key, null, { now: T0, start: true }), { kind: "prepare" });
  assert.deepEqual(nextStep(key, null, { now: T0, start: false }), { kind: "blocked", reason: "not_started" });
  assert.deepEqual(nextStep(key, { phase: "done", prepared_at: iso(T0), switched_at: iso(T0), clean_pass_at: iso(T0) }, { now: T0, start: true }), { kind: "prepare" });
  assert.deepEqual(nextStep(null, null, { now: T0, start: true }), { kind: "blocked", reason: "no_key" });
});

test("the switch waits until every reader's cache has turned over", () => {
  const prepared: RotationRow = { phase: "prepared", prepared_at: iso(T0), switched_at: null, clean_pass_at: null };
  const ready = { next_wrapped_key: "n", previous_wrapped_key: null };
  assert.deepEqual(nextStep(ready, prepared, { now: T0 + 60_000, start: true }), { kind: "wait", until: T0 + TURNOVER_MS, then: "switch" });
  assert.deepEqual(nextStep(ready, prepared, { now: T0 + TURNOVER_MS, start: true }), { kind: "switch" });
});

test("after the switch it re-seals until a clean pass began long enough after it, then retires", () => {
  const switched = (clean: number | null): RotationRow => ({ phase: "switched", prepared_at: iso(T0), switched_at: iso(T0), clean_pass_at: clean === null ? null : iso(clean) });
  const rotating = { next_wrapped_key: null, previous_wrapped_key: "p" };
  assert.deepEqual(nextStep(rotating, switched(null), { now: T0 + 1000, start: true }), { kind: "reseal" });
  // Clean, but too soon: a reader may still have sealed with the old key since that pass began.
  assert.deepEqual(nextStep(rotating, switched(T0 + 1000), { now: T0 + 2000, start: true }), { kind: "wait", until: T0 + GRACE_MS, then: "reseal" });
  assert.deepEqual(nextStep(rotating, switched(T0 + 1000), { now: T0 + GRACE_MS, start: true }), { kind: "reseal" });
  assert.deepEqual(nextStep(rotating, switched(T0 + GRACE_MS), { now: T0 + GRACE_MS + 5, start: true }), { kind: "retire" });
});

test("rows that disagree with the phase block rather than guess", () => {
  const prepared: RotationRow = { phase: "prepared", prepared_at: iso(T0), switched_at: null, clean_pass_at: null };
  const switched: RotationRow = { phase: "switched", prepared_at: iso(T0), switched_at: iso(T0), clean_pass_at: null };
  assert.equal(nextStep({ next_wrapped_key: "n", previous_wrapped_key: null }, null, { now: T0, start: true }).kind, "blocked");
  assert.equal(nextStep(key, prepared, { now: T0, start: true }).kind, "blocked");
  assert.equal(nextStep(key, switched, { now: T0, start: true }).kind, "blocked");
  assert.equal(nextStep({ next_wrapped_key: "n", previous_wrapped_key: "p" }, switched, { now: T0, start: true }).kind, "blocked");
});

test("a saved cursor is resumed, anything else starts a new pass", () => {
  const saved = { started: iso(T0), done: ["threads"], unit: "messages", after: { id: "m9" }, moved: 4, unreadable: 1, failed: 0 };
  assert.deepEqual(resumeCursor(saved, T0 + 5), saved);
  assert.deepEqual(resumeCursor({}, T0), { started: iso(T0), done: [], unit: null, after: null, moved: 0, unreadable: 0, failed: 0 });
  assert.equal(passIsClean({ ...saved, moved: 0, unreadable: 0 }, false), true);
  assert.equal(passIsClean({ ...saved, moved: 0 }, false), false);
  assert.equal(passIsClean({ ...saved, moved: 0 }, true), true);
  assert.equal(passIsClean(saved, true), false);
  assert.equal(passIsClean({ ...saved, moved: 0, unreadable: 0, failed: 1 }, true), false, "a failed unit is never accepted");
});
