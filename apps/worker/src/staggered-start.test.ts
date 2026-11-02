// Tests for staggered-start.ts: starts are grouped by lane, spread by jitter and gaps, and one failure does not stop the rest.

import { test } from "node:test";
import assert from "node:assert/strict";
import { startStaggered } from "./staggered-start";

const item = (lane: string, n: number) => ({ lane, n });

test("a lane within its limit starts at once with no waiting", async () => {
  const sleeps: number[] = [];
  const started: number[] = [];
  await startStaggered([item("a", 1), item("a", 2)], (i) => i.lane, (i) => started.push(i.n), () => assert.fail(), { defaultLimit: 5, sleep: async (ms) => void sleeps.push(ms) });
  assert.deepEqual(started, [1, 2]);
  assert.deepEqual(sleeps, []);
});

test("a long lane starts in groups with jitter and a gap between groups", async () => {
  const sleeps: number[] = [];
  const started: number[] = [];
  const items = Array.from({ length: 7 }, (_, i) => item("mail", i));
  await startStaggered(items, (i) => i.lane, (i) => started.push(i.n), () => assert.fail(), { defaultLimit: 3, jitterMs: 100, gapMs: 1000, random: () => 0.5, sleep: async (ms) => void sleeps.push(ms) });
  assert.deepEqual(started.sort(), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(sleeps.filter((ms) => ms === 1000).length, 2); // 3 groups, 2 gaps
  assert.equal(sleeps.filter((ms) => ms === 50).length, 7);
});

test("lanes have their own limits and a failing start is reported without stopping the others", async () => {
  const failed: number[] = [];
  const started: number[] = [];
  const items = [item("whatsapp", 1), item("whatsapp", 2), item("whatsapp", 3), item("mail", 4)];
  await startStaggered(items, (i) => i.lane, (i) => { if (i.n === 2) throw new Error("x"); started.push(i.n); }, (i) => failed.push(i.n), { limits: { whatsapp: 1 }, jitterMs: 0, gapMs: 0, sleep: async () => undefined });
  assert.deepEqual(failed, [2]);
  assert.deepEqual(started.sort(), [1, 3, 4]);
});
