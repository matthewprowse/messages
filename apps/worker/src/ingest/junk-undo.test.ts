import assert from "node:assert/strict";
import { test } from "node:test";
import { isUndoOfUnspam } from "./junk-undo";

const at = (action: string, iso: string) => ({ action, created_at: iso });

test("a spam action right after a Not Junk is its undo", () => {
  assert.equal(isUndoOfUnspam(at("spam", "2026-10-23T10:00:30Z"), at("unspam", "2026-10-23T10:00:00Z")), true);
});

test("a later or unrelated spam action is not an undo", () => {
  assert.equal(isUndoOfUnspam(at("spam", "2026-10-23T10:10:00Z"), at("unspam", "2026-10-23T10:00:00Z")), false);
  assert.equal(isUndoOfUnspam(at("spam", "2026-10-23T10:00:30Z"), at("archive", "2026-10-23T10:00:00Z")), false);
  assert.equal(isUndoOfUnspam(at("spam", "2026-10-23T10:00:30Z"), null), false);
  assert.equal(isUndoOfUnspam(at("unspam", "2026-10-23T10:00:30Z"), at("unspam", "2026-10-23T10:00:00Z")), false);
});
