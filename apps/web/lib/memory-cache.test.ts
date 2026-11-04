// Tests for memory-cache.ts: fresh values skip the load, loads of one key are shared, an edit made during a load wins,
// sign out empties everything, and the oldest keys go first.

import { test } from "node:test";
import assert from "node:assert/strict";
import { clearMemoryCaches, createMemoryCache, onClearMemory } from "./memory-cache";

function clock(start = 1000) {
  let t = start;
  return { now: () => t, tick: (ms: number) => { t += ms; } };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("a value younger than the max age is served without loading", async () => {
  const c = clock();
  const cache = createMemoryCache<number>({ now: c.now });
  let loads = 0;
  const fetch = async () => ++loads;
  assert.equal(await cache.load("k", fetch, 1000), 1);
  c.tick(500);
  assert.equal(await cache.load("k", fetch, 1000), 1);
  c.tick(600);
  assert.equal(await cache.load("k", fetch, 1000), 2);
  assert.equal(loads, 2);
});

test("two loads of one key at once make one request", async () => {
  const cache = createMemoryCache<string>();
  const d = deferred<string>();
  let loads = 0;
  const fetch = () => { loads++; return d.promise; };
  const a = cache.load("k", fetch);
  const b = cache.load("k", fetch);
  d.resolve("v");
  assert.deepEqual(await Promise.all([a, b]), ["v", "v"]);
  assert.equal(loads, 1);
  assert.equal(cache.get("k"), "v");
});

test("an edit stored while a load is out is not overwritten by it", async () => {
  const cache = createMemoryCache<string>();
  cache.set("k", "old");
  const d = deferred<string>();
  const run = cache.load("k", () => d.promise);
  cache.set("k", "edited");
  d.resolve("loaded");
  assert.equal(await run, "edited");
  assert.equal(cache.get("k"), "edited");
});

test("a load that outlives sign out stores nothing", async () => {
  const cache = createMemoryCache<string>();
  const d = deferred<string>();
  const run = cache.load("k", () => d.promise);
  clearMemoryCaches();
  d.resolve("secret");
  await run;
  assert.equal(cache.get("k"), undefined);
});

test("a failed load keeps the old value and lets the next one try again", async () => {
  const cache = createMemoryCache<string>();
  cache.set("k", "old");
  await assert.rejects(cache.load("k", () => Promise.reject(new Error("down"))));
  assert.equal(cache.get("k"), "old");
  assert.equal(await cache.load("k", async () => "new"), "new");
});

test("a patch changes the value but not its age, and invalidate keeps it but forces a load", () => {
  const c = clock();
  const cache = createMemoryCache<number[]>({ now: c.now });
  cache.set("k", [1]);
  c.tick(100);
  cache.patch("k", (v) => [...v, 2]);
  assert.deepEqual(cache.get("k"), [1, 2]);
  assert.equal(cache.age("k"), 100);
  cache.patch("missing", (v) => v);
  assert.equal(cache.get("missing"), undefined);
  cache.invalidate("k");
  assert.equal(cache.age("k"), Infinity);
  assert.deepEqual(cache.get("k"), [1, 2]);
});

test("the cache holds at most max keys, dropping the oldest stored", () => {
  const cache = createMemoryCache<number>({ max: 2 });
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("a", 3);
  cache.set("c", 4);
  assert.deepEqual(cache.keys().sort(), ["a", "c"]);
});

test("sign out empties every cache and runs the registered clearers", () => {
  const one = createMemoryCache<number>();
  const two = createMemoryCache<number>();
  one.set("a", 1);
  two.set("b", 2);
  let cleared = false;
  onClearMemory(() => { cleared = true; });
  let heard = 0;
  one.subscribe(() => heard++);
  clearMemoryCaches();
  assert.equal(one.get("a"), undefined);
  assert.equal(two.get("b"), undefined);
  assert.ok(cleared);
  assert.equal(heard, 1);
});
