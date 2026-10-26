import test from "node:test";
import assert from "node:assert/strict";
import { ai, usage, median, percentile, type Row } from "./stats";

const NOW = Date.parse("2026-10-26T12:00:00Z");
let n = 0;
function row(name: string, props: Record<string, unknown> = {}, extra: Partial<Row> = {}): Row {
  return { at: new Date(NOW - 3600_000 - n++ * 1000).toISOString(), user_hash: "u1", session: "s1", name, screen: null, size: "desktop", props, ...extra };
}

test("median and percentile", () => {
  assert.equal(median([1, 2, 3, 4, 100]), 3);
  assert.equal(percentile([10, 20, 30, 40], 95), 40);
  assert.equal(median([]), 0);
});

test("dialogs: abandon rate and the fields people touched", () => {
  const rows = [
    row("dialog_open", { dialog: "compose" }), row("dialog_open", { dialog: "compose" }), row("dialog_open", { dialog: "compose" }),
    row("dialog_close", { dialog: "compose", outcome: "submit", secs: 40, fields: ["to", "body"] }),
    row("dialog_close", { dialog: "compose", outcome: "cancel", secs: 5, fields: ["to"] }),
    row("dialog_close", { dialog: "compose", outcome: "cancel", secs: 3, fields: [] }),
  ];
  const d = usage(rows, NOW, 7).dialogs[0];
  assert.equal(d.opened, 3);
  assert.equal(d.submitted, 1);
  assert.equal(d.abandonPct, 66.7);
  assert.deepEqual(d.fields[0], { key: "to", n: 2 });
});

test("junk: false positives against everything the AI called junk, split by a trait", () => {
  const rows = [
    ...[1, 2, 3, 4].map(() => row("triaged", { junk: true, bulk: true, sender: "company", source: "model", prompt: "p1", channel: "email" })),
    ...[1, 2, 3, 4, 5, 6].map(() => row("triaged", { junk: false, bulk: false, sender: "person", source: "model", prompt: "p1", channel: "email" })),
    row("label_corrected", { field: "junk", from: "junk", to: "not_junk", bulk: true, sender: "company", source: "model", prompt: "p1", channel: "email" }),
    row("label_corrected", { field: "junk", from: "not_junk", to: "junk", bulk: false, sender: "person", source: "model", prompt: "p1", channel: "email" }),
  ];
  const r = ai(rows, NOW, 7);
  assert.equal(r.junk.falsePositivePct, 25);
  assert.equal(r.junk.falseNegativePct, 16.7);
  assert.deepEqual(r.splits.junk.sender.map((s) => [s.value, s.triaged, s.corrected]), [["company", 4, 1], ["person", 6, 1]]);
  assert.equal(r.pairs[0].n, 1);
});

test("drafts: sent as is, and what edits did", () => {
  const rows = [
    row("draft_sent", { channel: "email", tone: "default", edited: false, secs_to_send: 20, regenerated: 0 }),
    row("draft_sent", { channel: "email", tone: "default", edited: true, changed_pct: 50, len_pct: -40, greeting_changed: true, signoff_changed: false, q_added: false, q_removed: false, emoji_added: false, tone_shift: "casual", secs_to_send: 60, regenerated: 1 }),
    row("draft_discarded", { channel: "email", tone: "default", secs: 4 }),
  ];
  const d = ai(rows, NOW, 7).drafts;
  assert.equal(d.asIsPct, 50);
  assert.equal(d.discardedPct, 33.3);
  assert.equal(d.shorterPct, 100);
  assert.equal(d.greetingChangedPct, 100);
  assert.deepEqual(d.toneMoved, [{ key: "casual", n: 1 }]);
  assert.equal(d.avgRegenerated, 0.5);
});

test("summary misses: the original opened straight after a summary", () => {
  const t = (name: string, props: Record<string, unknown>, s: number) => row(name, props, { at: new Date(NOW - 10_000 + s * 1000).toISOString() });
  const rows = [
    t("thread_opened", { via: "summary", channel: "email", had_summary: true, unread: true }, 0),
    t("original_opened", { channel: "email" }, 2),
    t("thread_opened", { via: "summary", channel: "email", had_summary: true, unread: true }, 4),
    t("thread_opened", { via: "list", channel: "email", had_summary: true, unread: false }, 6),
  ];
  const s = ai(rows, NOW, 7).summaries;
  assert.equal(s.opened, 2);
  assert.equal(s.originalAfter, 1);
  assert.equal(s.hitPct, 50);
});

test("cost and speed by feature and prompt", () => {
  const call = (ms: number, ok = true) => row("ai_call", { feature: "triage", model: "m1", prompt: "p1", ms, ok, in_tok: 1000, out_tok: 100, cached_pct: 50, cost_micro: 2000, attempts: ok ? 1 : 3 });
  const r = ai([call(100), call(300), call(500, false)], NOW, 7).cost;
  assert.equal(r.usd.value, 0.006);
  assert.equal(r.byFeature[0].failPct, 33.3);
  assert.equal(r.byFeature[0].retries, 2);
  assert.equal(r.byFeature[0].cachedPct, 50);
  assert.equal(r.byPrompt[0].prompt, "p1");
});

test("someone is active when they used the app, not when the workers did something for them", () => {
  const rows = [
    row("ai_call", { feature: "triage", model: "m1", prompt: "p1", ms: 100, ok: true, in_tok: 1, out_tok: 1, cached_pct: 0, cost_micro: 1, attempts: 1 }, { user_hash: "worker_only" }),
    row("triaged", { junk: false }, { user_hash: "worker_only" }),
    row("screen_view", {}, { user_hash: "real", screen: "inbox" }),
  ];
  assert.equal(usage(rows, NOW, 7).activeUsers.value, 1);
});

test("history copied from the usage table counts towards spend but not towards speed", () => {
  const old = row("ai_call", { feature: "triage", model: "m1", prompt: "before_tracking", ok: true, in_tok: 1000, out_tok: 100, cached_pct: 0, cost_micro: 2000, attempts: 1 });
  const timed = row("ai_call", { feature: "triage", model: "m1", prompt: "p1", ms: 800, ok: true, in_tok: 1000, out_tok: 100, cached_pct: 0, cost_micro: 2000, attempts: 1 });
  const cost = ai([old, timed], NOW, 7).cost;
  assert.equal(cost.usd.value, 0.004);
  assert.equal(cost.byFeature[0].calls, 2);
  assert.equal(cost.byFeature[0].p50, 800);
});
