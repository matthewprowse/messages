// Tests for connectors/uid-set.ts: IMAP UID sets come out sorted, de-duplicated and with runs written as ranges.

import { test } from "node:test";
import assert from "node:assert/strict";
import { uidSet } from "./uid-set";

test("a run of UIDs becomes a range, a lone one stays alone", () => {
  assert.equal(uidSet([1, 2, 3, 4, 9]), "1:4,9");
  assert.equal(uidSet([7]), "7");
});

test("order and duplicates do not matter", () => {
  assert.equal(uidSet([9, 3, 1, 2, 3, 4, 1]), "1:4,9");
});

test("several runs are each written as a range", () => {
  assert.equal(uidSet([1, 2, 5, 6, 7, 10]), "1:2,5:7,10");
});

test("no UIDs is an empty set", () => {
  assert.equal(uidSet([]), "");
});
