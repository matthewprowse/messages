// Tests for phone-search.ts: South African numbers typed locally find the stored international form.

import assert from "node:assert/strict";
import { test } from "node:test";
import { looksLikePhoneQuery, phoneQueryMatches, searchDigits } from "./phone-search";

test("normalises South African numbers", () => {
  assert.equal(searchDigits("082 123 4567"), "27821234567");
  assert.equal(searchDigits("+27 (82) 123-4567"), "27821234567");
  assert.equal(searchDigits("0027821234567"), "27821234567");
  assert.equal(searchDigits("+1 415 555 0100"), "14155550100");
});

test("local queries match stored international digits", () => {
  const stored = "27821234567 27119876543";
  assert.equal(phoneQueryMatches("082 123 4567", stored), true);
  assert.equal(phoneQueryMatches("0821234567", stored), true);
  assert.equal(phoneQueryMatches("+27 82 123 4567", stored), true);
  assert.equal(phoneQueryMatches("082 12", stored), true);
  assert.equal(phoneQueryMatches("(011) 987", stored), true);
  assert.equal(phoneQueryMatches("083 123 4567", stored), false);
});

test("text is not a phone query", () => {
  assert.equal(looksLikePhoneQuery("thandi 082"), false);
  assert.equal(looksLikePhoneQuery("08"), false);
  assert.equal(phoneQueryMatches("thandi", "27821234567"), false);
});
