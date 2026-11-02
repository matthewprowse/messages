// Tests for merge-loaded.ts: a fetch applied on top of what changed here while it ran (removed, edited and added rows).

import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeById } from "./merge-loaded";

type Row = { id: string; title: string; done?: boolean };
const row = (id: string, title = id, done = false): Row => ({ id, title, done });

test("with nothing changed here the fetched rows win", () => {
  const out = mergeById([row("a")], [row("a", "fresh")], [row("a")]);
  assert.deepEqual(out, [row("a", "fresh")]);
});

test("a row removed here while the fetch ran stays removed", () => {
  const out = mergeById([row("a"), row("b")], [row("a"), row("b")], [row("a")]);
  assert.deepEqual(out.map((r) => r.id), ["a"]);
});

test("a field changed here keeps its local value, the other fields come from the fetch", () => {
  const out = mergeById([row("a", "old")], [row("a", "server", false)], [{ ...row("a", "old"), done: true }]);
  assert.deepEqual(out, [{ id: "a", title: "server", done: true }]);
});

test("a row added here is kept after the fetched ones, or first when asked", () => {
  const base = [row("a")];
  const current = [row("a"), row("new")];
  assert.deepEqual(mergeById(base, [row("a")], current).map((r) => r.id), ["a", "new"]);
  assert.deepEqual(mergeById(base, [row("a")], current, { addedFirst: true }).map((r) => r.id), ["new", "a"]);
});

test("a row deleted elsewhere goes, unless it only exists here and keepAlways says so", () => {
  assert.deepEqual(mergeById([row("a"), row("b")], [row("a")], [row("a"), row("b")]).map((r) => r.id), ["a"]);
  const out = mergeById([], [row("a")], [row("temp")], { keepAlways: (r) => r.id === "temp" });
  assert.deepEqual(out.map((r) => r.id), ["a", "temp"]);
  assert.deepEqual(mergeById([row("temp")], [], [row("temp")], { keepAlways: (r) => r.id === "temp" }).map((r) => r.id), ["temp"]);
});

test("an object field counts as unchanged when its contents are equal", () => {
  type Rich = { id: string; tags: string[]; n: number };
  const base: Rich[] = [{ id: "a", tags: ["x"], n: 1 }];
  const current: Rich[] = [{ id: "a", tags: ["x"], n: 1 }];
  const out = mergeById(base, [{ id: "a", tags: ["x", "y"], n: 2 }], current);
  assert.deepEqual(out, [{ id: "a", tags: ["x", "y"], n: 2 }]);
});
