// Tests for thread-read.ts: an open conversation is marked read once per arrival, and Mark as Unread sticks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readKey, shouldAutoRead, titleWithCount } from "./thread-read";

test("an unread conversation that has not been marked this arrival is armed", () => {
  assert.ok(shouldAutoRead(true, readKey("t1", "2026-11-02T10:00:00Z"), null));
});

test("after it was marked read, Mark as Unread on the same arrival is not undone", () => {
  const key = readKey("t1", "2026-11-02T10:00:00Z");
  assert.ok(!shouldAutoRead(true, key, key));
});

test("a new message while open is a new arrival and is armed again", () => {
  const old = readKey("t1", "2026-11-02T10:00:00Z");
  assert.ok(shouldAutoRead(true, readKey("t1", "2026-11-02T10:05:00Z"), old));
});

test("a read conversation is never armed", () => {
  assert.ok(!shouldAutoRead(false, readKey("t1", "x"), null));
});

test("the tab title carries the unread count, and a count already there is replaced", () => {
  assert.equal(titleWithCount("Inbox", 3), "(3) Inbox");
  assert.equal(titleWithCount("(3) Inbox", 5), "(5) Inbox");
  assert.equal(titleWithCount("(3) Inbox", 0), "Inbox");
  assert.equal(titleWithCount("Inbox", 250), "(99+) Inbox");
});
