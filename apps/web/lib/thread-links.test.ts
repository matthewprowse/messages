// Tests for thread-links.ts: rows map safely, linked pairs chain into matters, and only open suggestions are offered.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mapLink, matterGroups, pairOrder, pendingSuggestions, type ThreadLink } from "./thread-links";

const link = (a: string, b: string, status: ThreadLink["status"], score = 0.9): ThreadLink => ({ id: a + b, threadA: a, threadB: b, status, score, source: "similarity" });

test("a row maps to a link, and an unknown status or source falls back to the safe one", () => {
  const l = mapLink({ id: "1", thread_a: "a", thread_b: "b", contact_id: null, status: "weird", score: 0.7, source: "other" });
  assert.deepEqual(l, { id: "1", threadA: "a", threadB: "b", contactId: undefined, status: "dismissed", score: 0.7, source: "similarity" });
  assert.equal(mapLink({ id: "1", thread_a: "a", thread_b: "b", contact_id: "c", status: "linked", score: 1, source: "ai" }).source, "ai");
});

test("pairOrder puts the smaller id first", () => {
  assert.deepEqual(pairOrder("b", "a"), ["a", "b"]);
  assert.deepEqual(pairOrder("a", "b"), ["a", "b"]);
});

test("linked pairs chain into one matter and keep the order given", () => {
  const groups = matterGroups([link("a", "b", "linked"), link("b", "c", "linked"), link("d", "e", "linked")], ["e", "d", "c", "b", "a", "z"]);
  assert.deepEqual(groups, [["e", "d"], ["c", "b", "a"]]);
});

test("suggested and dismissed links make no matter, and a link to a thread out of scope is ignored", () => {
  assert.deepEqual(matterGroups([link("a", "b", "suggested"), link("c", "d", "dismissed"), link("a", "q", "linked")], ["a", "b", "c", "d"]), []);
});

test("pending suggestions are the open ones within scope, surest first", () => {
  const out = pendingSuggestions([link("a", "b", "suggested", 0.7), link("a", "c", "suggested", 0.9), link("a", "d", "linked"), link("a", "z", "suggested")], ["a", "b", "c", "d"]);
  assert.deepEqual(out.map((l) => l.threadB), ["c", "b"]);
});
