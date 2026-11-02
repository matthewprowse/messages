// Tests lib/admin-budget.ts: the budget form's rules, that a save keeps share keys the page does not list, the
// zero-share warning, the billing pause staleness rule and the usage summary.

import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMITS, badFields, billingState, budgetProblem, formSnapshot, mergeShares, projectMonth, sharesOf, shareTotal, unknownShares, usageSummary, zeroedFeatures, type BudgetForm } from "./admin-budget";

const form = (over: Partial<BudgetForm> = {}): BudgetForm => ({
  monthly: "5", shares: { triage: "30", draft: "30", learn: "15", brief: "10", transcribe: "15", bulk_read: "0" }, weeklyPct: "40", weekly: ["draft"], setupUsd: "1", setupDays: "7",
  limits: Object.fromEntries(LIMITS.map((x) => [x.key, "10"])) as BudgetForm["limits"], ...over,
});

test("a valid form has no problem", () => {
  assert.equal(budgetProblem(form(), {}), null);
  assert.equal(badFields(form()).size, 0);
});

test("a problem names the field and why", () => {
  assert.match(budgetProblem(form({ monthly: "" }), {})!, /Monthly Budget/);
  assert.match(budgetProblem(form({ shares: { ...form().shares, draft: "x" } }), {})!, /Drafts must be a share/);
  assert.match(budgetProblem(form({ shares: { ...form().shares, draft: "40" } }), {})!, /add up to 110%/);
  assert.match(budgetProblem(form({ setupDays: "1.5" }), {})!, /Setup Period/);
  assert.match(budgetProblem(form({ limits: { ...form().limits, regen_per_hour: "2.5" } }), {})!, /whole number/);
  assert.ok(badFields(form({ weeklyPct: "0" })).has("weeklyPct"));
});

test("shares the page has no row for count toward the total and survive a save", () => {
  const original = sharesOf({ triage: 30, draft: 30, learn: 15, brief: 10, transcribe: 10, bulk_read: 0, mystery: 5, bad: "x" });
  assert.deepEqual(unknownShares(original), { mystery: 5 });
  assert.equal(shareTotal(form(), original), 105);
  assert.match(budgetProblem(form(), original)!, /105%/);
  const edited = { triage: 30, draft: 30, learn: 15, brief: 10, transcribe: 10, bulk_read: 0 };
  assert.deepEqual(mergeShares(original, edited), { ...edited, mystery: 5 });
});

test("only a share going from something to zero is a warning", () => {
  assert.deepEqual(zeroedFeatures({ draft: 30, learn: 0 }, { draft: 0, learn: 0 }), ["draft"]);
  assert.deepEqual(zeroedFeatures({ draft: 30 }, { draft: 25 }), []);
  assert.deepEqual(zeroedFeatures({}, { bulk_read: 0 }), []);
});

test("the snapshot ignores spaces and the order of weekly features", () => {
  assert.equal(formSnapshot(form({ monthly: " 5 ", weekly: ["learn", "draft"] })), formSnapshot(form({ weekly: ["draft", "learn"] })));
  assert.notEqual(formSnapshot(form()), formSnapshot(form({ monthly: "6" })));
});

test("billing shows as paused only while the worker keeps confirming it", () => {
  const now = Date.parse("2026-11-17T15:00:00Z");
  assert.deepEqual(billingState(null, now), { paused: false, since: null });
  assert.equal(billingState({ billing_paused_since: "2026-11-17T14:02:00Z", billing_checked_at: "2026-11-17T14:55:00Z" }, now).paused, true);
  assert.equal(billingState({ billing_paused_since: "2026-11-17T14:02:00Z", billing_checked_at: "2026-11-17T14:02:00Z" }, now).paused, false);
  assert.equal(billingState({ billing_paused_since: null, billing_checked_at: null }, now).paused, false);
});

test("the month projection waits a day and then scales to the month length", () => {
  assert.equal(projectMonth(5, new Date("2026-11-01T12:00:00Z")), null);
  assert.equal(projectMonth(10, new Date("2026-11-11T00:00:00Z")), 30);
});

test("the usage summary counts people and features", () => {
  const s = usageSummary([
    { month_usd: 2, flag: "x", paused: ["draft"] },
    { month_usd: 3, flag: null, paused: ["draft", "learn"] },
    { month_usd: 1, flag: null, paused: [] },
  ]);
  assert.equal(s.total, 6);
  assert.equal(s.flagged, 1);
  assert.equal(s.paused, 2);
  assert.deepEqual(s.byFeature, [["draft", 2], ["learn", 1]]);
});
