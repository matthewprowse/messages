// Tests for the usage sums behind Settings, Usage and the navigation ring: which limits apply, the closest one, and paused features.
import assert from "node:assert/strict";
import { test } from "node:test";
import { closestLimit, featuresOf, limitsOf, type Allowance } from "./usage";

const allowance = (over: Partial<Allowance> = {}): Allowance => ({
  used_pct: 30, resets_at: "2026-12-01T00:00:00Z", features: { triage: 20, draft: 50 },
  week_pct: 60, week_resets_at: "2026-11-09T00:00:00Z", week_features: { draft: 60 }, ...over,
});

test("limitsOf lists the week, the month and storage in order", () => {
  const limits = limitsOf(allowance(), { held: 5, cap: 20, team: false });
  assert.deepEqual(limits.map((l) => [l.key, l.pct]), [["week", 60], ["month", 30], ["storage", 25]]);
});

test("limitsOf leaves out the week when no feature has a weekly limit", () => {
  const limits = limitsOf(allowance({ week_features: {} }), null);
  assert.deepEqual(limits.map((l) => l.key), ["month"]);
});

test("limitsOf names team storage and clamps over 100", () => {
  const [storage] = limitsOf(null, { held: 30, cap: 20, team: true });
  assert.equal(storage.label, "Team Storage");
  assert.equal(storage.pct, 100);
});

test("closestLimit picks the highest percentage, and nothing when there are no limits", () => {
  assert.equal(closestLimit(limitsOf(allowance(), { held: 19, cap: 20, team: false }))?.key, "storage");
  assert.equal(closestLimit([]), null);
});

test("featuresOf marks a feature paused by its week or its month", () => {
  const f = featuresOf(allowance({ features: { triage: 100, draft: 40 }, week_features: { draft: 100 } }));
  assert.equal(f.find((x) => x.feature === "triage")?.pausedUntil, "2026-12-01T00:00:00Z");
  assert.equal(f.find((x) => x.feature === "draft")?.pausedUntil, "2026-11-09T00:00:00Z");
});
