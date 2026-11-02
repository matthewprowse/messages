// Tests for analytics/derive.ts. They pin down the empty summary, reach and daily series, grouping of dialog events, draft shares and medians,
// label splits and corrections, cost and retries, and when a contact summary counts as enough.

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSummary, type Summary, type SummaryGroup } from "../../lib/analytics-data";
import { build } from "./derive";

// The summary ends at the start of the day after the last one shown.
const TO = "2026-10-26T00:00:00.000Z";
const n = (sum: number, count = 1) => ({ n: count, sum, p50: 0, p95: 0 });
const g = (name: string, props: SummaryGroup["props"], count: number, nums: SummaryGroup["nums"] = {}, extra: Partial<SummaryGroup> = {}): SummaryGroup => ({
  period: "now",
  name,
  screen: null,
  props,
  n: count,
  users: count,
  nums,
  ...extra,
});

function summary(over: Partial<Summary> = {}): Summary {
  return parseSummary({
    to: TO,
    periods: { now: { users: 4, sessions: 6, opens: 9, events: 50, user_days: 8 }, before: { users: 5, sessions: 7, opens: 3, events: 20, user_days: 5 } },
    came_back: 2,
    daily: [
      { day: "2026-10-25", users: 3, sessions: 4 },
      { day: "2026-10-24", users: 2, sessions: 2 },
    ],
    ...over,
  });
}

test("an empty summary is empty and does not throw", () => {
  const r = build(parseSummary({ to: TO }), 7);
  assert.equal(r.empty, true);
  assert.equal(r.usage.series.length, 7);
  assert.equal(r.ai.cost.byFeature.length, 0);
});

test("reach comes from the period totals, the series fills quiet days with zero", () => {
  const r = build(summary(), 3).usage;
  assert.deepEqual(r.activeUsers, { value: 4, prev: 5 });
  assert.deepEqual(r.opens, { value: 9, prev: 3 });
  assert.deepEqual(r.cameBack, { part: 2, whole: 5 });
  assert.deepEqual(r.series, [
    { day: "2026-10-23", users: 0 },
    { day: "2026-10-24", users: 2 },
    { day: "2026-10-25", users: 3 },
  ]);
});

test("dialogs add up their groups and count fields by how often they were touched", () => {
  const s = summary({
    groups: [
      g("dialog_open", { dialog: "compose" }, 10),
      g("dialog_close", { dialog: "compose", outcome: "submit", fields: ["to", "body"] }, 3),
      g("dialog_close", { dialog: "compose", outcome: "cancel", fields: ["to"] }, 2),
    ],
    percentiles: [{ period: "now", metric: "dialog_close.secs", key: "compose", n: 5, p50: 12, p95: 30 }],
  });
  const [d] = build(s, 7).usage.dialogs;
  assert.deepEqual({ opened: d.opened, submitted: d.submitted, cancelled: d.cancelled, medianSecs: d.medianSecs }, { opened: 10, submitted: 3, cancelled: 2, medianSecs: 12 });
  assert.deepEqual(d.fields, [{ key: "to", n: 5 }, { key: "body", n: 3 }]);
});

test("a pick is a search that carries a rank", () => {
  const s = summary({ groups: [g("search", {}, 4, { len: n(20, 4), results: n(8, 4), picked_rank: n(5, 2) })] });
  const r = build(s, 7).usage;
  assert.equal(r.searches, 4);
  assert.deepEqual(r.picked, { part: 2, whole: 4 });
});

test("reliability counts sends sent and failed, and has no retry count because sends are never retried", () => {
  const s = summary({
    groups: [
      g("send_result", { outcome: "sent" }, 3),
      g("send_result", { outcome: "failed" }, 1),
      g("wa_reconnect", { reason: "connection_lost" }, 2),
    ],
  });
  assert.deepEqual(build(s, 7).usage.reliability, { syncErrors: [], sent: 3, failed: 1, reconnects: 2 });
});

test("people per feature, screen and error come from the database, not the largest group", () => {
  const s = summary({
    groups: [
      g("feature_used", { feature: "merge_contacts", detail: "a" }, 4, {}, { users: 2 }),
      g("feature_used", { feature: "merge_contacts", detail: "b" }, 3, {}, { users: 2 }),
      g("screen_view", {}, 5, {}, { screen: "inbox", users: 3 }),
      g("error", { code: "typeerror", where: "inbox" }, 2, {}, { users: 1 }),
    ],
    distinct_users: [
      { period: "now", metric: "feature_used.feature", key: "merge_contacts", users: 3 },
      { period: "now", metric: "screen_view.screen", key: "inbox", users: 4 },
      { period: "now", metric: "error.code_where", key: "typeerror|inbox", users: 2 },
      { period: "before", metric: "feature_used.feature", key: "merge_contacts", users: 9 },
    ],
  });
  const r = build(s, 7).usage;
  assert.deepEqual(r.features, [{ feature: "merge_contacts", uses: 7, users: 3 }]);
  assert.equal(r.screens[0].users, 4);
  assert.equal(r.errors[0].users, 2);
});

test("events dropped by the rate limit are passed on so the page can say counts are low", () => {
  assert.equal(build(summary({ dropped: 12 }), 7).usage.dropped, 12);
  assert.equal(build(summary(), 7).usage.dropped, 0);
});

test("the last day shown is the day before the summary's end, which is a day boundary", () => {
  const r = build(summary({ daily: [{ day: "2026-10-25", users: 3, sessions: 4 }] }), 2).usage;
  assert.deepEqual(r.series, [{ day: "2026-10-24", users: 0 }, { day: "2026-10-25", users: 3 }]);
});

test("drafts: shares of the edited drafts, as written by tone, medians from the percentiles", () => {
  const s = summary({
    groups: [
      g("draft_sent", { tone: "warm", channel: "email" }, 6, { regenerated: n(3, 6) }),
      g("draft_sent", { tone: "warm", channel: "email", edited: true, greeting_changed: true, tone_shift: "formal" }, 3, { changed_pct: n(60, 3), regenerated: n(0, 3) }),
      g("draft_sent", { tone: "brief", channel: "whatsapp", edited: true, q_added: true, tone_shift: "same" }, 1, { changed_pct: n(20, 1) }),
    ],
    percentiles: [{ period: "now", metric: "draft_sent.secs_to_send", key: "", n: 10, p50: 41, p95: 90 }],
  });
  const d = build(s, 7).ai.drafts;
  assert.deepEqual(d.asWritten, { part: 6, whole: 10 });
  assert.deepEqual(d.edited, { part: 4, whole: 10 });
  assert.equal(d.avgChangedPct, 20);
  assert.equal(d.avgRegenerated, 0.3);
  assert.deepEqual(d.greeting, { part: 3, whole: 4 });
  assert.deepEqual(d.toneMoved, [{ key: "formal", n: 3 }]);
  assert.equal(d.medianSecsToSend, 41);
  assert.deepEqual(d.byTone.map((t) => [t.tone, t.sent, t.asWritten.part]), [["warm", 9, 6], ["brief", 1, 0]]);
});

test("label splits count labels and corrections for the same value", () => {
  const trait = { sender: "bulk", channel: "email", bulk: true, attach: false, len: "short", hour: "night", known: false, source: "model", prompt: "v1" };
  const s = summary({
    groups: [
      g("triaged", { ...trait, junk: true }, 10),
      g("triaged", { ...trait, sender: "person", junk: false }, 30),
      g("label_corrected", { sender: "bulk", field: "junk", from: "junk", to: "not_junk" }, 4),
    ],
  });
  const r = build(s, 7).ai;
  assert.deepEqual(r.splits.junk.sender, [
    { value: "bulk", triaged: 10, corrected: 4 },
    { value: "person", triaged: 30, corrected: 0 },
  ]);
  assert.deepEqual(r.junk, { shown: 10, notJunk: 4, missed: 0, notShown: 30 });
  assert.deepEqual(r.pairs, [{ field: "junk", from: "junk", to: "not_junk", n: 4 }]);
});

test("cost: spend, failures, retries, timings and the daily series", () => {
  const call = { feature: "triage", model: "gemini", prompt: "v2" };
  const s = summary({
    groups: [
      g("ai_call", { ...call, ok: true }, 4, { cost_micro: n(2_000_000, 4), in_tok: n(1000, 4), cached_pct: n(200, 4), attempts: n(5, 4) }),
      g("ai_call", { ...call, ok: false }, 1, { cost_micro: n(500_000), in_tok: n(0), attempts: n(1) }),
      g("ai_call", { ...call, ok: true }, 2, { cost_micro: n(1_000_000, 2) }, { period: "before" }),
    ],
    events: [
      { day: "2026-10-25", name: "ai_call", n: 5, users: 1, sums: { cost_micro: 2_500_000 } },
      { day: "2026-10-24", name: "app_open", n: 5, users: 1, sums: {} },
    ],
    cost_users: { users: 2, total_micro: 2_500_000, p50_micro: 500_000, p90_micro: 2_000_000, top: [{ user: "ab12cd34", micro: 2_000_000 }] },
    percentiles: [
      { period: "now", metric: "ai_call.ms", key: "triage", n: 5, p50: 800, p95: 2000 },
      { period: "now", metric: "ai_call.ms_prompt", key: "triage|gemini|v2", n: 5, p50: 700, p95: 1900 },
    ],
  });
  const c = build(s, 2).ai.cost;
  assert.equal(c.calls, 5);
  assert.equal(c.failed, 1);
  assert.deepEqual(c.usd, { value: 2.5, prev: 1 });
  assert.deepEqual(c.series, [{ day: "2026-10-24", usd: 0 }, { day: "2026-10-25", usd: 2.5 }]);
  assert.equal(c.inTok, 1000);
  assert.equal(c.cachedTok, 500);
  assert.deepEqual({ ...c.byFeature[0] }, { feature: "triage", calls: 5, failed: 1, retries: 1, p50: 800, p95: 2000, usd: 2.5, inTok: 1000, cachedTok: 500 });
  assert.equal(c.byPrompt[0].p50, 700);
  // Cost per person is scaled to a 30 day month: 2 days shown, so 15 times the period figure.
  assert.deepEqual(c.perUserMonth, { users: 2, avgUsd: 18.75, p90Usd: 30, top: [{ user: "ab12cd34", usd: 30 }] });
});

test("summaries: enough is the opened ones that did not lead to the original", () => {
  const r = build(summary({ summaries: { opened: 10, original_after: 3 } }), 7).ai.summaries;
  assert.deepEqual(r, { enough: { part: 7, whole: 10 }, originalAfter: 3 });
});

test("only labels that can be corrected by hand are split: priority and junk, not category", () => {
  const r = build(summary(), 7).ai;
  assert.deepEqual(Object.keys(r.splits).sort(), ["junk", "priority"]);
});
