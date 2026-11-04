// Tests for stale.ts: the linker drops its own pending pairs it no longer finds, keeps the ones it found again (also
// through a merge made this run), and never drops a suggestion an automation made or one already decided.

import { test } from "node:test";
import assert from "node:assert/strict";
import { pairKey } from "./match";
import { madeElsewhere, staleSuggestions, type SuggestionRow } from "./stale";

const row = (id: string, a: string, b: string, extra: Partial<SuggestionRow> = {}): SuggestionRow => ({ id, contact_a: a, contact_b: b, status: "pending", evidence: { certain: "email" }, ...extra });

test("pending pairs not found again are stale, found ones and decided ones are not", () => {
  const decided = [row("1", "a", "b"), row("2", "c", "d"), row("3", "e", "f", { status: "dismissed" })];
  assert.deepEqual(staleSuggestions(decided, new Set([pairKey("a", "b")]), (id) => id), ["2"]);
});

test("a pair is matched through the contact a merge this run kept", () => {
  const rep = (id: string) => (id === "old" ? "kept" : id);
  assert.deepEqual(staleSuggestions([row("1", "old", "x")], new Set([pairKey("kept", "x")]), rep), []);
});

test("a pending suggestion an automation made is kept even when the linker does not find the pair", () => {
  const decided = [row("1", "a", "b", { evidence: { source: "automation" } }), row("2", "c", "d", { evidence: null })];
  assert.deepEqual(staleSuggestions(decided, new Set(), (id) => id), ["2"]);
  assert.equal(madeElsewhere({ source: "automation" }), true);
  assert.equal(madeElsewhere({ source: "linker" }), false);
  assert.equal(madeElsewhere(["automation"]), false);
  assert.equal(madeElsewhere(undefined), false);
});
