// Tests for reply-restore.ts: text handed back for a conversation is kept until its box reads it, once.

import assert from "node:assert/strict";
import { test } from "node:test";
import { restoreReply, takeRestored } from "./reply-restore";

test("restored text waits for its conversation and is read once", () => {
  restoreReply("t1", "hello again");
  assert.equal(takeRestored("t2"), undefined);
  assert.equal(takeRestored("t1"), "hello again");
  assert.equal(takeRestored("t1"), undefined);
});

test("a second restore replaces the first", () => {
  restoreReply("t1", "one");
  restoreReply("t1", "two");
  assert.equal(takeRestored("t1"), "two");
});
