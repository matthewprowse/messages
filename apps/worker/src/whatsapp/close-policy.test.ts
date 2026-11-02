// Tests for whatsapp/close-policy.ts: only a logout wipes; replaced, refused and corrupt sessions back off and escalate.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ATTENTION_AFTER, CODE, decideClose, noCloses, PAUSE_CAP_MS, PAUSE_STEP_MS, type CloseCounts } from "./close-policy";

const close = (status: number | undefined, counts: CloseCounts = noCloses(), extra: { ownsAccount?: boolean; wasLinked?: boolean } = {}) =>
  decideClose({ status, wasLinked: extra.wasLinked ?? true, ownsAccount: extra.ownsAccount ?? true, counts });

test("only a definite logout wipes the session", () => {
  assert.equal(close(CODE.loggedOut).action.kind, "logged-out");
  for (const status of [CODE.forbidden, CODE.multideviceMismatch, CODE.badSession, CODE.connectionReplaced, undefined]) assert.notEqual(close(status).action.kind, "logged-out");
});

test("a refusal backs off, then asks for attention, and never stops", () => {
  let counts = noCloses();
  const delays: number[] = [];
  let attention: string | null = null;
  for (let i = 0; i < ATTENTION_AFTER.forbidden; i++) {
    const r = close(CODE.forbidden, counts);
    counts = r.counts;
    assert.equal(r.action.kind, "reconnect");
    if (r.action.kind === "reconnect") { delays.push(r.action.minDelayMs); attention = r.action.attention; }
  }
  assert.deepEqual(delays, [PAUSE_STEP_MS, PAUSE_STEP_MS * 2]);
  assert.ok(attention);
});

test("the pause is capped", () => {
  const r = close(CODE.badSession, { forbidden: 0, replaced: 0, bad: 40 });
  assert.equal(r.action.kind === "reconnect" && r.action.minDelayMs, PAUSE_CAP_MS);
});

test("a bad session asks to relink after repeated failures", () => {
  let counts = noCloses();
  const notes: (string | null)[] = [];
  for (let i = 0; i < ATTENTION_AFTER.bad; i++) {
    const r = close(CODE.badSession, counts);
    counts = r.counts;
    notes.push(r.action.kind === "reconnect" ? r.action.attention : "x");
  }
  assert.deepEqual(notes.slice(0, -1), [null, null]);
  assert.match(notes.at(-1)!, /Scan the QR/);
});

test("a replaced connection reconnects for the owner and yields for the other worker", () => {
  assert.equal(close(CODE.connectionReplaced).action.kind, "reconnect");
  assert.deepEqual(close(CODE.connectionReplaced, noCloses(), { ownsAccount: false }).action, { kind: "yield" });
});

test("repeated replacement is surfaced", () => {
  const r = close(CODE.connectionReplaced, { forbidden: 0, replaced: ATTENTION_AFTER.replaced - 1, bad: 0 });
  assert.ok(r.action.kind === "reconnect" && r.action.attention);
});

test("restart, expired code and plain drops keep their old handling", () => {
  assert.equal(close(CODE.restartRequired).action.kind, "restart");
  assert.equal(close(CODE.timedOut, noCloses(), { wasLinked: false }).action.kind, "link-expired");
  assert.deepEqual(close(CODE.timedOut).action, { kind: "reconnect", minDelayMs: 0, attention: null });
});
