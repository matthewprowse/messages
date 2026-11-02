// Tests for thumb-cache.ts: the bounded LRU of opened thumbnails revokes the links it drops.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ThumbCache } from "./thumb-cache";

test("the least recently used link is revoked when the cache is full", () => {
  const revoked: string[] = [];
  const cache = new ThumbCache(3, (u) => revoked.push(u));
  cache.set("a", "blob:a");
  cache.set("b", "blob:b");
  cache.set("c", "blob:c");
  assert.equal(cache.get("a"), "blob:a"); // a is now the newest
  cache.set("d", "blob:d");
  assert.deepEqual(revoked, ["blob:b"]);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.size, 3);
});

test("replacing an id revokes the old link and a repeat of the same link does not", () => {
  const revoked: string[] = [];
  const cache = new ThumbCache(3, (u) => revoked.push(u));
  cache.set("a", "blob:1");
  cache.set("a", "blob:1");
  assert.deepEqual(revoked, []);
  cache.set("a", "blob:2");
  assert.deepEqual(revoked, ["blob:1"]);
  assert.equal(cache.get("a"), "blob:2");
  assert.equal(cache.size, 1);
});

test("the default bound is 300", () => {
  const cache = new ThumbCache(undefined, () => {});
  for (let i = 0; i < 350; i++) cache.set(String(i), `blob:${i}`);
  assert.equal(cache.size, 300);
  assert.equal(cache.get("0"), undefined);
  assert.equal(cache.get("349"), "blob:349");
});

test("clear revokes every link and empties the cache", () => {
  const revoked: string[] = [];
  const cache = new ThumbCache(5, (url) => revoked.push(url));
  cache.set("a", "blob:a");
  cache.set("b", "blob:b");
  cache.clear();
  assert.equal(cache.size, 0);
  assert.deepEqual(revoked.sort(), ["blob:a", "blob:b"]);
});
