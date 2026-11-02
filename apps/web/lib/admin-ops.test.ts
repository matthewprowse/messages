// Tests for admin-ops.ts: queue and lease thresholds, connector summaries, spend history arithmetic, the alert list and the audit diff.

import assert from "node:assert/strict";
import { test } from "node:test";
import { ageText, auditChanges, buildAlerts, errorTotals, leaseLevel, monthTotals, personHistories, providerSummaries, queueLevel, sparkPath, sparkSeries, spendToday, splitLeases, worst, type Health } from "./admin-ops";

const NOW = new Date("2026-11-15T12:00:00Z");
const q = (key: string, depth: number, oldest_age_s: number | null) => ({ key, depth, oldest_age_s });

test("a queue is green when empty, amber past its first time and red past its second", () => {
  assert.equal(queueLevel(q("outbox", 0, null)), "green");
  assert.equal(queueLevel(q("outbox", 3, 119)), "green");
  assert.equal(queueLevel(q("outbox", 3, 120)), "amber");
  assert.equal(queueLevel(q("outbox", 3, 600)), "red");
  assert.equal(queueLevel(q("outbox", 1, null)), "green");
  assert.equal(queueLevel(q("something_new", 5, 99999)), "green");
});

test("an AI batch is only late after the day Google promises", () => {
  assert.equal(queueLevel(q("ai_batches", 4, 10 * 3600)), "green");
  assert.equal(queueLevel(q("ai_batches", 4, 13 * 3600)), "amber");
  assert.equal(queueLevel(q("ai_batches", 4, 27 * 3600)), "red");
});

test("a lease is red when run out, amber when a renewal was missed", () => {
  assert.equal(leaseLevel({ name: "shard-0", expires_in_s: 85 }), "green");
  assert.equal(leaseLevel({ name: "shard-0", expires_in_s: 29 }), "amber");
  assert.equal(leaseLevel({ name: "shard-0", expires_in_s: 0 }), "red");
  assert.equal(leaseLevel({ name: "shard-0", expires_in_s: -40 }), "red");
});

test("worst picks the worst level and splitLeases separates the AI lease", () => {
  assert.equal(worst([]), "green");
  assert.equal(worst(["green", "red", "amber"]), "red");
  const s = splitLeases([{ name: "ai", expires_in_s: 60 }, { name: "shard-0", expires_in_s: 60 }]);
  assert.equal(s.ai?.name, "ai");
  assert.deepEqual(s.shards.map((l) => l.name), ["shard-0"]);
});

test("ages read as seconds, minutes, hours and days", () => {
  assert.equal(ageText(null), "None");
  assert.equal(ageText(45), "45 s");
  assert.equal(ageText(600), "10 min");
  assert.equal(ageText(7200), "2 h");
  assert.equal(ageText(3 * 86400), "3 d");
});

test("providers are summed across statuses, with the stalest connected sync deciding the level", () => {
  const rows = providerSummaries([
    { provider: "gmail", status: "connected", n: 4, freshest_age_s: 60, stalest_age_s: 7200 },
    { provider: "gmail", status: "error", n: 1, freshest_age_s: null, stalest_age_s: null },
    { provider: "whatsapp", status: "error", n: 2, freshest_age_s: null, stalest_age_s: null },
    { provider: "imap", status: "connected", n: 1, freshest_age_s: 10, stalest_age_s: 20 },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.provider, r]));
  assert.equal(by.gmail.total, 5);
  assert.equal(by.gmail.connected, 4);
  assert.equal(by.gmail.stalestS, 7200);
  assert.equal(by.gmail.level, "amber");
  assert.equal(by.whatsapp.level, "red");
  assert.equal(by.imap.level, "green");
  assert.deepEqual(rows.map((r) => r.provider), ["gmail", "imap", "whatsapp"]);
});

test("a very old sync is red", () => {
  const [r] = providerSummaries([{ provider: "gmail", status: "connected", n: 1, freshest_age_s: 7 * 3600, stalest_age_s: 7 * 3600 }]);
  assert.equal(r.level, "red");
});

test("error codes are added up per provider and code", () => {
  const t = errorTotals([
    { event: "sync_error", provider: "gmail", code: "invalid_grant", n: 2 },
    { event: "send_result", provider: "gmail", code: "invalid_grant", n: 3 },
    { event: "sync_error", provider: "imap", code: "ETIMEDOUT", n: 1 },
  ]);
  assert.deepEqual(t, [{ provider: "gmail", code: "invalid_grant", n: 5 }, { provider: "imap", code: "ETIMEDOUT", n: 1 }]);
});

test("a person's daily series fills quiet days with zero and ends today", () => {
  const daily = [
    { user_id: "u1", email: "a@x.test", day: "2026-11-15", usd: 1.5 },
    { user_id: "u1", email: "a@x.test", day: "2026-11-13", usd: 0.5 },
    { user_id: "u2", email: "b@x.test", day: "2026-11-15", usd: 9 },
  ];
  const s = sparkSeries(daily, "u1", NOW, 5);
  assert.deepEqual(s, [0, 0, 0.5, 0, 1.5]);
  assert.equal(spendToday(daily, NOW), 10.5);
});

test("the sparkline path puts the tallest value on top and a flat zero series on the bottom", () => {
  assert.equal(sparkPath([], 10, 10), "");
  assert.equal(sparkPath([0, 5, 10], 20, 10), "M0.0 10.0 L10.0 5.0 L20.0 0.0");
  assert.equal(sparkPath([0, 0], 10, 4), "M0.0 4.0 L10.0 4.0");
});

test("people are ranked by 30 day spend, with month over month and features", () => {
  const h = {
    at: NOW.toISOString(),
    daily: [
      { user_id: "u1", email: "a@x.test", day: "2026-11-15", usd: 1 },
      { user_id: "u2", email: "b@x.test", day: "2026-11-14", usd: 4 },
    ],
    monthly: [
      { user_id: "u2", email: "b@x.test", month: "2026-10-01", usd: 10 },
      { user_id: "u2", email: "b@x.test", month: "2026-11-01", usd: 15 },
      { user_id: "u1", email: "a@x.test", month: "2026-11-01", usd: 1 },
    ],
    features: [{ user_id: "u2", feature: "draft", usd: 1 }, { user_id: "u2", feature: "triage", usd: 3 }],
  };
  const people = personHistories(h, NOW);
  assert.deepEqual(people.map((p) => p.userId), ["u2", "u1"]);
  assert.equal(people[0].monthChangePct, 50);
  assert.equal(people[1].monthChangePct, null);
  assert.equal(people[0].features[0].feature, "triage");
  assert.equal(people[1].today, 1);
  assert.deepEqual(monthTotals(h.monthly), [{ month: "2026-10", usd: 10 }, { month: "2026-11", usd: 16 }]);
});

const healthy: Health = { at: NOW.toISOString(), leases: [{ name: "shard-0", expires_in_s: 80 }, { name: "ai", expires_in_s: 70 }], queues: [q("outbox", 0, null)] };
const input = { health: healthy, billingPausedSince: null, unpricedModels: [], todayUsd: 1, dailyLimitUsd: 20 };

test("nothing is wrong, so no alerts", () => {
  assert.deepEqual(buildAlerts(input), []);
});

test("billing paused, an expired lease, a stuck queue, an unpriced model and heavy spend each raise an alert, worst first", () => {
  const alerts = buildAlerts({
    health: { ...healthy, leases: [{ name: "shard-0", expires_in_s: -5 }, { name: "ai", expires_in_s: 70 }], queues: [q("outbox", 2, 130), q("drafts", 9, 4000)] },
    billingPausedSince: "2026-11-15T10:00:00Z",
    unpricedModels: ["gemini-9"],
    todayUsd: 25,
    dailyLimitUsd: 20,
  });
  assert.deepEqual(alerts.map((a) => a.id).sort(), ["billing", "daily-spend", "lease-shard-0", "price-gemini-9", "queue-drafts", "queue-outbox"]);
  assert.equal(alerts[0].level, "red");
  assert.equal(alerts[alerts.length - 1].level, "amber");
  assert.equal(alerts.find((a) => a.id === "queue-outbox")?.level, "amber");
});

test("spend is amber from 80 percent of the limit, and a missing AI lease is flagged", () => {
  const near = buildAlerts({ ...input, todayUsd: 16 });
  assert.equal(near[0].id, "daily-spend");
  assert.equal(near[0].level, "amber");
  const noAi = buildAlerts({ ...input, health: { ...healthy, leases: [{ name: "shard-0", expires_in_s: 80 }] } });
  assert.equal(noAi[0].id, "lease-ai-missing");
});

test("alerts need data to be raised: without health or a limit only billing and prices can", () => {
  assert.deepEqual(buildAlerts({ health: null, billingPausedSince: null, unpricedModels: [], todayUsd: 99, dailyLimitUsd: null }), []);
});

test("an audit row lists only the fields that changed", () => {
  assert.deepEqual(auditChanges({ monthly_usd: 5, weekly_pct: 30 }, { monthly_usd: 6, weekly_pct: 30 }), [{ key: "monthly_usd", from: "5", to: "6" }]);
  assert.deepEqual(auditChanges(null, { seats: 5 }), [{ key: "seats", from: "None", to: "5" }]);
  assert.deepEqual(auditChanges({ status: "pending" }, { status: "approved" }), [{ key: "status", from: "pending", to: "approved" }]);
  assert.deepEqual(auditChanges({ shares: { a: 1 } }, { shares: { a: 2 } }), [{ key: "shares", from: '{"a":1}', to: '{"a":2}' }]);
});
