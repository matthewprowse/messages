// account-deletion.ts: the 7 day grace period, the typed words and the pending banner text.

import assert from "node:assert/strict";
import { test } from "node:test";
import { canCancel, GRACE_DAYS, isDeleteWord, isRemoveWord, pendingText, runAfterFor } from "./account-deletion";

const NOW = Date.parse("2026-11-20T10:00:00Z");

test("a request made now runs seven days later", () => {
  assert.equal(GRACE_DAYS, 7);
  assert.equal(runAfterFor(NOW), "2026-11-27T10:00:00.000Z");
});

test("only the exact word confirms", () => {
  assert.equal(isDeleteWord("DELETE"), true);
  assert.equal(isDeleteWord(" DELETE "), true);
  for (const no of ["delete", "Delete", "DELET", "DELETE ME", ""]) assert.equal(isDeleteWord(no), false);
  assert.equal(isRemoveWord("REMOVE"), true);
  assert.equal(isRemoveWord("DELETE"), false);
});

test("a pending request says the date and how long is left", () => {
  const text = pendingText({ run_after: "2026-11-27T10:00:00Z", status: "pending" }, NOW);
  assert.match(text, /27 November 2026/);
  assert.match(text, /in 7 days/);
  assert.match(pendingText({ run_after: "2026-11-21T09:00:00Z", status: "pending" }, NOW), /in 1 day\)/);
});

test("a request that is due or running says it is being deleted and cannot be cancelled", () => {
  assert.match(pendingText({ run_after: "2026-11-20T09:00:00Z", status: "pending" }, NOW), /being deleted now/);
  assert.match(pendingText({ run_after: "2026-11-30T09:00:00Z", status: "running" }, NOW), /being deleted now/);
  assert.equal(canCancel({ run_after: "x", status: "running" }), false);
  assert.equal(canCancel({ run_after: "x", status: "pending" }), true);
  assert.equal(canCancel({ run_after: "x", status: "failed" }), true);
});

test("the text has no dashes", () => {
  assert.doesNotMatch(pendingText({ run_after: "2026-11-27T10:00:00Z", status: "pending" }, NOW), /[–—]/);
});
