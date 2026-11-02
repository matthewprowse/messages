// Tests for key-policy.ts: who gets keys, and how the token's assurance level is read.

import { test } from "node:test";
import assert from "node:assert/strict";
import { keyAccess, tokenAal } from "./key-policy";

const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

test("no factor, or an unverified one, is never blocked", () => {
  assert.deepEqual(keyAccess(undefined, "aal1"), { ok: true });
  assert.deepEqual(keyAccess([], null), { ok: true });
  assert.deepEqual(keyAccess([{ status: "unverified" }], "aal1"), { ok: true });
});

test("a verified factor needs an aal2 session", () => {
  const f = [{ status: "verified" }];
  assert.equal(keyAccess(f, "aal1").ok, false);
  assert.equal(keyAccess(f, null).ok, false);
  assert.equal(keyAccess(f, "weird").ok, false);
  assert.deepEqual(keyAccess(f, "aal2"), { ok: true });
});

test("the refusal is a 401 that asks for the code", () => {
  const r = keyAccess([{ status: "verified" }], "aal1");
  assert.ok(!r.ok && r.status === 401 && /two-factor/.test(r.message));
});

test("tokenAal reads the claim and shrugs at junk", () => {
  assert.equal(tokenAal(jwt({ aal: "aal2" })), "aal2");
  assert.equal(tokenAal(jwt({ aal: "aal1" })), "aal1");
  assert.equal(tokenAal(jwt({ aal: "x" })), null);
  assert.equal(tokenAal("nope"), null);
  assert.equal(tokenAal("a.%%%.c"), null);
});
