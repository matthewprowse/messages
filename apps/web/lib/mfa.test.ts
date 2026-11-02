// Tests for mfa.ts: when the code step is needed, which factor counts, and what a code looks like.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanCode, needsSecondFactor, verifiedTotp } from "./mfa";

test("the code step is needed only between aal1 and a possible aal2", () => {
  assert.equal(needsSecondFactor({ currentLevel: "aal1", nextLevel: "aal2" }), true);
  assert.equal(needsSecondFactor({ currentLevel: "aal2", nextLevel: "aal2" }), false);
  assert.equal(needsSecondFactor({ currentLevel: "aal1", nextLevel: "aal1" }), false);
  assert.equal(needsSecondFactor(null), false);
});

test("only verified authenticator-app factors are challenged", () => {
  const list = [
    { id: "a", factor_type: "totp", status: "unverified" },
    { id: "b", factor_type: "totp", status: "verified" },
    { id: "c", factor_type: "phone", status: "verified" },
  ];
  assert.deepEqual(verifiedTotp(list).map((f) => f.id), ["b"]);
  assert.deepEqual(verifiedTotp(undefined), []);
});

test("codes are six digits, with spaces and dashes forgiven", () => {
  assert.equal(cleanCode("123 456"), "123456");
  assert.equal(cleanCode("123-456"), "123456");
  assert.equal(cleanCode("12345"), null);
  assert.equal(cleanCode("12345a"), null);
  assert.equal(cleanCode("1234567"), null);
});
