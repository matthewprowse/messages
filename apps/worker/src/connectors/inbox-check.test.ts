// Tests for connectors/inbox-check.ts: when the Inbox reconcile can be skipped and when it must run in full.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FULL_RECONCILE_EVERY_MS, reconcileDue, type InboxMark } from "./inbox-check";

const mark: InboxMark = { uidValidity: 7, uidNext: 101, exists: 100 };
const last = { mark, at: 1_000_000 };
const soon = last.at + 5 * 60_000;

test("the first look of a session, or a forced one, is always full", () => {
  assert.equal(reconcileDue(null, mark, soon), true);
  assert.equal(reconcileDue(last, mark, soon, true), true);
});

test("nothing changed: skipped", () => {
  assert.equal(reconcileDue(last, mark, soon), false);
});

test("new mail only: skipped", () => {
  assert.equal(reconcileDue(last, { ...mark, uidNext: 104, exists: 103 }, soon), false);
});

test("a message left, with or without new arrivals: full", () => {
  assert.equal(reconcileDue(last, { ...mark, exists: 99 }, soon), true);
  assert.equal(reconcileDue(last, { ...mark, uidNext: 103, exists: 101 }, soon), true);
});

test("a renumbered folder or a falling UIDNEXT: full", () => {
  assert.equal(reconcileDue(last, { ...mark, uidValidity: 8 }, soon), true);
  assert.equal(reconcileDue(last, { ...mark, uidNext: 50, exists: 49 }, soon), true);
});

test("an hour passes: full, whatever the numbers say", () => {
  assert.equal(reconcileDue(last, mark, last.at + FULL_RECONCILE_EVERY_MS), true);
  assert.equal(reconcileDue(last, mark, last.at - 1), true);
});
