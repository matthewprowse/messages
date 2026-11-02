// Tests for analytics/derive-health.ts: the funnel is shown against everyone who signed up, retention picks the
// definition of active asked for, and per person figures do not divide by zero.

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHealth } from "../../lib/analytics-health";
import { channelRows, daysSince, funnelRows, retentionRows, stickinessPct, valueRows } from "./derive-health";

const health = parseHealth({
  funnel: { cohort: 8, steps: [{ key: "connected_account", users: 6, p50_secs: 300 }, { key: "first_draft_sent", users: 2, p50_secs: null }] },
  retention: [
    { start: "2026-10-05", size: 4, later_active: [3, 2], later_valued: [1, 0] },
    { start: "2026-10-12", size: 0, later_active: [], later_valued: [] },
    { start: "2026-10-19", size: 3, later_active: [2], later_valued: [1] },
  ],
  stickiness: { wau: 5, mau: 8, dau_avg: 2, resurrected: 1, curve: [] },
  value: { now: { active: 4, replies: 10, drafts_sent: 6, triaged: 40, junk_cleared: 2 }, before: { active: 0, replies: 3, drafts_sent: 0, triaged: 0, junk_cleared: 0 } },
  channels: [{ mix: "email", users: 5, active_7d: 2, valued_28d: 1 }, { mix: "none", users: 0, active_7d: 0, valued_28d: 0 }],
});

test("the funnel starts with everyone who signed up and shows each step as a share of them", () => {
  const rows = funnelRows(health);
  assert.deepEqual(rows.map((r) => [r.key, r.users, r.pct]), [["signed_up", 8, 100], ["connected_account", 6, 75], ["first_draft_sent", 2, 25]]);
  assert.equal(rows[1].p50, 300);
  assert.equal(rows[2].p50, null);
});

test("an empty cohort gives a funnel of zeros, not NaN", () => {
  const rows = funnelRows(parseHealth({}));
  assert.deepEqual(rows, [{ key: "signed_up", users: 0, pct: 0, p50: 0 }]);
});

test("retention uses the definition of active asked for, newest week first, skipping empty groups", () => {
  assert.deepEqual(retentionRows(health, "active").map((r) => [r.start, r.size, r.later]), [["2026-10-19", 3, [2]], ["2026-10-05", 4, [3, 2]]]);
  assert.deepEqual(retentionRows(health, "valued")[1].later, [1, 0]);
});

test("stickiness is daily over monthly active people, and 0 with nobody active", () => {
  assert.equal(stickinessPct(health), 25);
  assert.equal(stickinessPct(parseHealth({})), 0);
});

test("value is per active person, and 0 when there were no active people", () => {
  const rows = valueRows(health);
  assert.deepEqual(rows.find((r) => r.key === "replies"), { key: "replies", now: 2.5, before: 0, total: 10 });
  assert.equal(rows.find((r) => r.key === "triaged")?.now, 10);
});

test("channels show how many of each mix were active this week", () => {
  assert.deepEqual(channelRows(health)[0], { mix: "email", users: 5, activePct: 40, valued28d: 1 });
  assert.equal(channelRows(health)[1].activePct, 0);
});

test("days since a date counts whole UTC days and never goes negative", () => {
  const now = Date.parse("2026-11-17T10:00:00Z");
  assert.equal(daysSince("2026-11-10", now), 7);
  assert.equal(daysSince("2026-11-20", now), 0);
  assert.equal(daysSince("nonsense", now), 0);
});
