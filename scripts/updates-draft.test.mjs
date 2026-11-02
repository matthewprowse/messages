// Tests for scripts/updates-draft.mjs: release commits and merges are left out, subjects are cleaned, kinds are guessed from
// the first word, and the changes come out oldest first in the shape the Updates dialog takes.
// Run by CI with `node --test scripts/updates-draft.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanSubject, draftFromCommits, isReleaseSubject, kindOf } from "./updates-draft.mjs";

test("a release subject starts with a version", () => {
  assert.equal(isReleaseSubject("v0.0.16"), true);
  assert.equal(isReleaseSubject("v1.2.3 Dark mode"), true);
  assert.equal(isReleaseSubject("Move v1 to v2"), false);
});

test("cleanSubject drops the wave prefix, capitalises and caps the length", () => {
  assert.equal(cleanSubject("wave7: what's new"), "What's new");
  assert.equal(cleanSubject("  fix  double   spaces "), "Fix double spaces");
  assert.ok(cleanSubject("x".repeat(400)).length <= 300);
});

test("kindOf guesses from the first word", () => {
  assert.equal(kindOf("Fix the unread count"), "fixed");
  assert.equal(kindOf("wave6: add automations"), "new");
  assert.equal(kindOf("Keep the old mail check cadence"), "improved");
});

test("draftFromCommits skips releases and merges and reads oldest first", () => {
  const d = draftFromCommits([
    { sha: "c3", subject: "v0.0.17" },
    { sha: "c2", subject: "Fix a crash" },
    { sha: "c1", subject: "Merge branch 'x'" },
    { sha: "c0", subject: "Add a thing" },
  ], "v0.0.16");
  assert.deepEqual(d.changes, [{ kind: "new", text: "Add a thing" }, { kind: "fixed", text: "Fix a crash" }]);
  assert.equal(d.since, "v0.0.16");
  assert.deepEqual(d.commits, ["c0 Add a thing", "c2 Fix a crash"]);
});

test("no commits gives an empty list", () => assert.deepEqual(draftFromCommits([], undefined).changes, []));
