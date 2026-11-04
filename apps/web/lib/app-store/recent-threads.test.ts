// Tests for recent-threads.ts: how many conversations keep their messages, how prefetched ones give way to opened ones,
// and which are caught up after a reconnect.

import assert from "node:assert/strict";
import { test } from "node:test";
import { catchUpSet, holdPrefetched, roomToPrefetch, touchHeld } from "./recent-threads";

test("using a conversation moves it to the newest end without dropping anything under the cap", () => {
  const r = touchHeld(["a", "b", "c"], "a", null, 5);
  assert.deepEqual(r.order, ["b", "c", "a"]);
  assert.deepEqual(r.evict, []);
});

test("over the cap the oldest go, but never the open conversation", () => {
  const r = touchHeld(["open", "b", "c"], "d", "open", 3);
  assert.deepEqual(r.order, ["open", "c", "d"]);
  assert.deepEqual(r.evict, ["b"]);
});

test("the conversation just used is kept even with a cap of one", () => {
  const r = touchHeld(["a", "b"], "c", null, 1);
  assert.deepEqual(r.order, ["c"]);
  assert.deepEqual(r.evict, ["a", "b"]);
});

test("a catch-up takes the open conversation first and then the newest used", () => {
  assert.deepEqual(catchUpSet(["a", "b", "c", "d"], "b", 3), ["b", "c", "d"]);
  assert.deepEqual(catchUpSet(["a", "b", "c"], null, 2), ["b", "c"]);
  assert.deepEqual(catchUpSet(["a", "b"], "zzz", 2), ["a", "b"]);
});

test("a prefetched conversation goes in behind the other guesses and ahead of every opened one", () => {
  const r = holdPrefetched(["p1", "o1", "o2"], "p2", null, new Set(["p1"]), 5);
  assert.deepEqual(r.order, ["p1", "p2", "o1", "o2"]);
  assert.deepEqual(r.evict, []);
});

test("over the cap a prefetch drops the oldest guess, never an opened conversation", () => {
  const r = holdPrefetched(["p1", "p2", "o1", "o2"], "p3", null, new Set(["p1", "p2"]), 4);
  assert.deepEqual(r.order, ["p2", "p3", "o1", "o2"]);
  assert.deepEqual(r.evict, ["p1"]);
});

test("with only opened conversations held at the cap, the prefetch itself is dropped", () => {
  const r = holdPrefetched(["o1", "o2"], "p", "o2", new Set(), 2);
  assert.deepEqual(r.order, ["o1", "o2"]);
  assert.deepEqual(r.evict, ["p"]);
});

test("a prefetched conversation that is open is not dropped for another guess", () => {
  const r = holdPrefetched(["p1", "o1"], "p2", "p1", new Set(["p1"]), 2);
  assert.deepEqual(r.order, ["p1", "o1"]);
  assert.deepEqual(r.evict, ["p2"]);
});

test("prefetching one already held changes nothing", () => {
  assert.deepEqual(holdPrefetched(["o1", "o2"], "o1", null, new Set(), 2), { order: ["o1", "o2"], evict: [] });
});

test("opening drops guesses before opened conversations, as they sit at the oldest end", () => {
  const r = touchHeld(["p1", "o1", "o2"], "o3", "o2", 3);
  assert.deepEqual(r.evict, ["p1"]);
});

test("there is room to prefetch under the cap, or when an older guess can make way", () => {
  assert.equal(roomToPrefetch(["o1"], null, new Set(), 2), true);
  assert.equal(roomToPrefetch(["o1", "o2"], null, new Set(), 2), false);
  assert.equal(roomToPrefetch(["p1", "o1"], null, new Set(["p1"]), 2), true);
  assert.equal(roomToPrefetch(["p1", "o1"], "p1", new Set(["p1"]), 2), false);
});
