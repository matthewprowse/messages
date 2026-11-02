// Tests for recent-threads.ts: how many conversations keep their messages and which are caught up after a reconnect.

import assert from "node:assert/strict";
import { test } from "node:test";
import { catchUpSet, touchHeld } from "./recent-threads";

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
