// Tests for whatsapp/bounded-map.ts: the oldest entry goes first, and reading an entry keeps it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BoundedMap } from "./bounded-map";

test("the oldest entry is dropped once the bound is passed", () => {
  const m = new BoundedMap<string, number>(2);
  m.set("a", 1).set("b", 2).set("c", 3);
  assert.deepEqual([...m.keys()], ["b", "c"]);
  assert.equal(m.size, 2);
});

test("reading or rewriting an entry keeps it", () => {
  const m = new BoundedMap<string, number>(2);
  m.set("a", 1).set("b", 2);
  assert.equal(m.get("a"), 1);
  m.set("c", 3);
  assert.deepEqual([...m.keys()], ["a", "c"]);
  m.set("a", 9).set("d", 4);
  assert.deepEqual([...m.keys()], ["a", "d"]);
  assert.equal(m.get("a"), 9);
});

test("a miss returns undefined and has() does not reorder", () => {
  const m = new BoundedMap<string, number | null>(2);
  m.set("a", null).set("b", 2);
  assert.equal(m.get("zzz"), undefined);
  assert.equal(m.has("a"), true);
  m.set("c", 3);
  assert.equal(m.has("a"), false);
  assert.equal(m.get("c"), 3);
});

test("a stored null is a hit, not a miss", () => {
  const m = new BoundedMap<string, string | null>(3);
  m.set("x", null);
  assert.equal(m.get("x"), null);
  assert.equal(m.has("x"), true);
});
