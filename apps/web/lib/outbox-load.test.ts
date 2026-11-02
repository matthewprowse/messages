// Tests for outbox-load.ts: which outbox rows come back after a reload, what a retry of them keeps, and the dismissed list.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mergePending, pendingOfRow, readDismissed, rememberDismissed, shownRows, type OutboxLoadRow } from "./outbox-load";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const row = (o: Partial<OutboxLoadRow> = {}): OutboxLoadRow => ({
  id: "r1", thread_id: "t1", body: "Hi", status: "failed", error: "Nope", created_at: "2026-11-10T10:00:00Z",
  from_address: null, to_addresses: [], cc_addresses: [], attachment_count: 0, ...o,
});
const store = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

test("a Reply All row keeps its recipients and From for a retry", () => {
  const p = pendingOfRow(row({ from_address: "me@x.com", to_addresses: ["a@x.com"], cc_addresses: ["b@x.com"] }));
  assert.deepEqual(p?.copies, { to: ["a@x.com"], cc: ["b@x.com"] });
  assert.equal(p?.fromAddress, "me@x.com");
  assert.equal(pendingOfRow(row())?.copies, undefined);
});

test("only queued, sending and failed replies in a conversation are shown", () => {
  assert.equal(pendingOfRow(row({ status: "sent" })), null);
  assert.equal(pendingOfRow(row({ thread_id: null })), null);
  assert.equal(pendingOfRow(row({ status: "queued" }))?.status, "queued");
});

test("dismissed and long-stale failed rows are left out; stale queued rows stay", () => {
  const rows = [row({ id: "a" }), row({ id: "b" }), row({ id: "old", created_at: "2026-10-01T00:00:00Z" }), row({ id: "q", status: "queued", created_at: "2026-10-01T00:00:00Z" })];
  assert.deepEqual(shownRows(rows, new Set(["a"]), NOW).map((p) => p.id), ["b", "q"]);
});

test("mergePending adds loaded rows and keeps held ones as they are", () => {
  const held = [pendingOfRow(row({ id: "x", status: "queued" }))!];
  const loaded = [pendingOfRow(row({ id: "x" }))!, pendingOfRow(row({ id: "y" }))!];
  const out = mergePending(held, loaded);
  assert.deepEqual(out.map((p) => p.id), ["x", "y"]);
  assert.equal(out[0].status, "queued");
  assert.equal(mergePending(held, []), held);
});

test("dismissed ids are remembered and survive a bad store", () => {
  const s = store();
  rememberDismissed("a", s);
  rememberDismissed("b", s);
  assert.deepEqual([...readDismissed(s)], ["a", "b"]);
  assert.deepEqual([...readDismissed({ getItem: () => { throw new Error("blocked"); } })], []);
  assert.deepEqual([...readDismissed({ getItem: () => "not json" })], []);
});
