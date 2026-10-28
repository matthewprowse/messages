import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRelay, waitForReply, type Relay } from "./relay";

const step = { kind: "code" as const, method: "email" as const, canTryAnotherWay: false, attempts: 1, rejected: false };

test("a relay keeps a step, a six-digit code and a request for another way, and drops the rest", () => {
  assert.deepEqual(parseRelay({ step, code: "123456", tryAnotherWay: true, extra: "x" }), { step, code: "123456", tryAnotherWay: true });
  assert.deepEqual(parseRelay({ step: { kind: "sms", attempts: "2" }, code: "12 3456" }), { step: null });
  assert.deepEqual(parseRelay({ step: { kind: "app", method: "carrier-pigeon", canTryAnotherWay: true } }), {
    step: { kind: "app", method: null, canTryAnotherWay: true, attempts: 0, rejected: false },
  });
  assert.deepEqual(parseRelay(null), { step: null });
  assert.deepEqual(parseRelay("nonsense"), { step: null });
});

test("waiting for a code returns it as soon as it is there", async () => {
  const reads: Relay[] = [{ step }, { step }, { step, code: "654321" }];
  const waits: number[] = [];
  const reply = await waitForReply(async () => reads.shift() ?? { step }, async (ms) => void waits.push(ms), { want: "code", timeoutMs: 60_000, pollMs: 2_000, stopped: () => false });
  assert.deepEqual(reply, { code: "654321" });
  assert.deepEqual(waits, [2_000, 2_000]);
});

test("a code is no answer to a wait for another way, and the other way round", async () => {
  let t = 0;
  const now = () => t;
  const wait = async (ms: number) => void (t += ms);
  const opts = { timeoutMs: 10_000, pollMs: 2_000, stopped: () => false, now };
  assert.equal(await waitForReply(async () => ({ step, code: "123456" }), wait, { ...opts, want: "anotherWay" }), null);
  t = 0;
  assert.equal(await waitForReply(async () => ({ step, tryAnotherWay: true }), wait, { ...opts, want: "code" }), null);
  t = 0;
  assert.deepEqual(await waitForReply(async () => ({ step, tryAnotherWay: true }), wait, { ...opts, want: "anotherWay" }), { anotherWay: true });
});

test("waiting gives up when the time is up, or when told to stop, and carries on past a failed read", async () => {
  let t = 0;
  const wait = async (ms: number) => void (t += ms);
  assert.equal(await waitForReply(async () => ({ step }), wait, { want: "code", timeoutMs: 6_000, pollMs: 2_000, stopped: () => false, now: () => t }), null);
  assert.equal(t, 6_000);
  assert.equal(await waitForReply(async () => ({ step, code: "123456" }), wait, { want: "code", timeoutMs: 6_000, pollMs: 2_000, stopped: () => true }), null);
  let reads = 0;
  const reply = await waitForReply(
    async () => {
      if (++reads === 1) throw new Error("network");
      return { step, code: "111111" };
    },
    async () => undefined,
    { want: "code", timeoutMs: 60_000, pollMs: 1, stopped: () => false },
  );
  assert.deepEqual(reply, { code: "111111" });
});
