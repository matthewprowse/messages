// Tests for shrinkOldBulk (ingest/shrink-bulk.ts): the preview cut and which messages are eligible, over a faked database.
// No database, key service or provider is touched.

import assert from "node:assert/strict";
import { test } from "node:test";
import { previewOf, shrinkOldBulk, type Candidate, type ShrinkDeps } from "./shrink-bulk";

const NOW = Date.parse("2026-12-01T00:00:00Z");
const DAY = 86_400_000;
const long = "word ".repeat(300).trim();

test("previewOf leaves short text alone", () => {
  assert.equal(previewOf("hello there"), "hello there");
  assert.equal(previewOf("x".repeat(500)), "x".repeat(500));
});

test("previewOf cuts at a word boundary", () => {
  const out = previewOf(long);
  assert.ok(out.length <= 500 && out.length > 450);
  assert.ok(long.startsWith(out));
  assert.ok(out.endsWith("word"));
});

test("previewOf counts characters, not UTF-16 units", () => {
  const emoji = "😀".repeat(600);
  assert.equal(Array.from(previewOf(emoji)).length, 500);
  assert.ok(!previewOf(emoji).includes("\ud83d\ud83d"));
  const accented = "héllo wörld ".repeat(100);
  assert.ok(accented.startsWith(previewOf(accented)) && /(héllo|wörld)$/.test(previewOf(accented)));
});

test("previewOf hard-cuts a text with no spaces", () => {
  assert.equal(previewOf("a".repeat(900)).length, 500);
});

function setup(rows: Partial<Candidate>[], extra: Partial<ShrinkDeps> = {}) {
  const store = new Map<string, Candidate & { shrunk?: string }>();
  rows.forEach((r, i) => store.set(`m${i}`, { id: `m${i}`, user_id: "u", thread_id: `t${i}`, sender_index: `s${i}`, sent_at: new Date(NOW - (40 - i) * DAY).toISOString(), body_text: `e1:${long}`, body_marks: "[1]", ...r }));
  const deps: Partial<ShrinkDeps> = {
    now: () => NOW,
    candidates: async (cutoff, after, n) => [...store.values()].filter((r) => !r.shrunk && r.sent_at < cutoff && (!after || r.sent_at > after)).sort((a, b) => a.sent_at.localeCompare(b.sent_at)).slice(0, n),
    repliedThreads: async () => new Set(),
    heldThreads: async () => new Set(),
    writtenTo: async () => false,
    open: async (_u, t) => t.replace(/^e1:/, ""),
    seal: async (_u, t) => `e1:${t}`,
    sealing: () => true,
    apply: async (id, p) => {
      const r = store.get(id)!;
      if (r.shrunk) return false;
      r.shrunk = p.body_shrunk_at;
      r.body_text = p.body_text;
      r.body_marks = null;
      return true;
    },
    cursor: { after: null },
    ...extra,
  };
  return { store, deps };
}

test("shortens old bulk mail, resealed, and clears marks", async () => {
  const { store, deps } = setup([{}]);
  const res = await shrinkOldBulk(50, deps);
  assert.equal(res.shrunk, 1);
  const m = store.get("m0")!;
  assert.ok(m.body_text!.startsWith("e1:") && m.body_text!.length < 520);
  assert.equal(m.body_marks, null);
  assert.ok(res.bytesAfter < res.bytesBefore);
});

test("age: mail under 30 days is left alone", async () => {
  const { deps } = setup([{ sent_at: new Date(NOW - 10 * DAY).toISOString() }]);
  assert.equal((await shrinkOldBulk(50, deps)).shrunk, 0);
});

test("replied, held and written-to mail is skipped", async () => {
  const { store, deps } = setup([{}, {}, {}, {}], {
    repliedThreads: async () => new Set(["t0"]),
    heldThreads: async () => new Set(["t1"]),
    writtenTo: async (_u, idx) => idx === "s2",
  });
  const res = await shrinkOldBulk(50, deps);
  assert.equal(res.shrunk, 1);
  assert.equal(res.skipped, 3);
  assert.ok(store.get("m3")!.shrunk);
  assert.ok(!store.get("m0")!.shrunk && !store.get("m1")!.shrunk && !store.get("m2")!.shrunk);
});

test("a key failure is skipped, counted and nothing is written", async () => {
  const { store, deps } = setup([{}, {}], { open: async (_u, t) => { if (t === "e1:" + long && store0.n++ === 0) throw new Error("no key"); return t.replace(/^e1:/, ""); } });
  const res = await shrinkOldBulk(50, deps);
  assert.equal(res.keyErrors, 1);
  assert.equal(res.shrunk, 1);
  assert.ok(!store.get("m0")!.shrunk);
});
const store0 = { n: 0 };

test("a seal that comes back as plain text is not written", async () => {
  const { store, deps } = setup([{}], { seal: async (_u, t) => t });
  const res = await shrinkOldBulk(50, deps);
  assert.equal(res.keyErrors, 1);
  assert.ok(!store.get("m0")!.shrunk);
});

test("sealing off for a sealed value is skipped", async () => {
  const { deps } = setup([{}], { sealing: () => false });
  assert.equal((await shrinkOldBulk(50, deps)).keyErrors, 1);
});

test("a second run does nothing, and the batch is bounded", async () => {
  const { deps } = setup([{}, {}, {}]);
  assert.equal((await shrinkOldBulk(2, deps)).shrunk, 2);
  assert.equal((await shrinkOldBulk(2, deps)).shrunk, 1);
  assert.equal((await shrinkOldBulk(2, deps)).shrunk, 0);
});

test("skipped mail does not block the queue", async () => {
  const rows = Array.from({ length: 6 }, () => ({}));
  const { store, deps } = setup(rows, { repliedThreads: async () => new Set(["t0", "t1", "t2", "t3"]) });
  for (let i = 0; i < 3; i++) await shrinkOldBulk(1, deps);
  assert.ok(store.get("m4")!.shrunk);
});

test("plain (unsealed) text is cut without sealing", async () => {
  const { store, deps } = setup([{ body_text: long }], { sealing: () => false });
  assert.equal((await shrinkOldBulk(50, deps)).shrunk, 1);
  assert.ok(!store.get("m0")!.body_text!.startsWith("e1:"));
});
