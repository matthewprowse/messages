// Tests for which in-flight rows a worker may settle at startup (owned rows, shard 0 orphans, grace and minimum age).

import assert from "node:assert/strict";
import { test } from "node:test";
import { planRecovery, type InFlightRow } from "./recovery-plan";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const row = (id: string, accountId: string | null, ageMs: number, claimedAgo?: number): InFlightRow => ({
  id, accountId, created_at: ago(ageMs), claimed_at: claimedAgo === undefined ? undefined : ago(claimedAgo),
});
const mine = (id: string) => id.startsWith("m");

test("only rows of owned accounts are settled at startup, however fresh", () => {
  const rows = [row("a", "m1", 1000), row("b", "other", 10 * 3_600_000), row("c", "m2", 5)];
  assert.deepEqual(planRecovery(rows, { owns: mine, primary: false, now: NOW }), ["a", "c"]);
});

test("rows of an unknown account are left to shard 0, after the grace period", () => {
  const rows = [row("old", null, 10 * 60_000), row("fresh", null, 30_000)];
  assert.deepEqual(planRecovery(rows, { owns: mine, primary: true, now: NOW }), ["old"]);
  assert.deepEqual(planRecovery(rows, { owns: mine, primary: false, now: NOW }), []);
});

test("a minimum age keeps a recent claim, and claimed_at beats created_at", () => {
  const rows = [row("long-queued", "m1", 3_600_000, 1000), row("stale", "m1", 3_600_000, 20 * 60_000), row("noclaim", "m1", 20 * 60_000)];
  assert.deepEqual(planRecovery(rows, { owns: mine, primary: true, now: NOW, minAgeMs: 10 * 60_000 }), ["stale", "noclaim"]);
});

test("with one worker everything is settled", () => {
  const rows = [row("a", "x", 0), row("b", null, 60 * 60_000)];
  assert.deepEqual(planRecovery(rows, { owns: () => true, primary: true, now: NOW }), ["a", "b"]);
});
