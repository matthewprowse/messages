// reauth.ts: which proofs are accepted, and that each method asks Supabase Auth the right question and fails closed.

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseProof, sendEmailCode, verifyProof, type AuthCall } from "./reauth";

const plain = { email: "a@example.com", factors: [] };
const user = { email: "a@example.com", factors: [{ id: "f1", factor_type: "totp", status: "verified" }] };

test("a proof needs a known method and a usable secret", () => {
  assert.deepEqual(parseProof({ method: "password", password: "pw" }), { method: "password", password: "pw" });
  assert.deepEqual(parseProof({ method: "totp", code: "123 456" }), { method: "totp", code: "123456" });
  assert.deepEqual(parseProof({ method: "email", code: "12345678" }), { method: "email", code: "12345678" });
  for (const bad of [null, "x", {}, { method: "password", password: "" }, { method: "totp", code: "12ab56" }, { method: "email", code: "123" }, { method: "sms", code: "123456" }]) assert.equal(parseProof(bad), null);
});

test("a password is checked by signing in with it", async () => {
  const seen: unknown[] = [];
  const call: AuthCall = async (path, body) => { seen.push([path, body]); return { ok: true, json: {} }; };
  assert.equal(await verifyProof(call, plain, "tok", { method: "password", password: "pw" }), true);
  assert.deepEqual(seen, [["token?grant_type=password", { email: "a@example.com", password: "pw" }]]);
});

test("a phone or passkey factor also rules out a password or emailed code, and has no code path here", async () => {
  let calls = 0;
  const call: AuthCall = async () => { calls++; return { ok: true, json: { id: "c1" } }; };
  for (const factor_type of ["phone", "webauthn"]) {
    const other = { email: "a@example.com", factors: [{ id: "f2", factor_type, status: "verified" }] };
    assert.equal(await verifyProof(call, other, "tok", { method: "password", password: "pw" }), false);
    assert.equal(await verifyProof(call, other, "tok", { method: "email", code: "123456" }), false);
    assert.equal(await verifyProof(call, other, "tok", { method: "totp", code: "123456" }), false);
  }
  assert.equal(calls, 0);
});

test("someone with an authenticator app cannot use a password or emailed code instead", async () => {
  let calls = 0;
  const call: AuthCall = async () => { calls++; return { ok: true, json: {} }; };
  assert.equal(await verifyProof(call, user, "tok", { method: "password", password: "pw" }), false);
  assert.equal(await verifyProof(call, user, "tok", { method: "email", code: "123456" }), false);
  assert.equal(calls, 0);
});

test("a wrong password is refused", async () => {
  assert.equal(await verifyProof(async () => ({ ok: false, json: {} }), plain, "tok", { method: "password", password: "no" }), false);
});

test("an authenticator code is a challenge then a verify, both with the person's own token", async () => {
  const seen: [string, Record<string, unknown>, string | undefined][] = [];
  const call: AuthCall = async (path, body, bearer) => { seen.push([path, body, bearer]); return { ok: true, json: { id: "c1" } }; };
  assert.equal(await verifyProof(call, user, "tok", { method: "totp", code: "123456" }), true);
  assert.deepEqual(seen, [["factors/f1/challenge", {}, "tok"], ["factors/f1/verify", { challenge_id: "c1", code: "123456" }, "tok"]]);
});

test("an authenticator code from someone with no verified factor is refused without a call", async () => {
  let calls = 0;
  const call: AuthCall = async () => { calls++; return { ok: true, json: {} }; };
  assert.equal(await verifyProof(call, { email: "a@example.com", factors: [{ id: "f", factor_type: "totp", status: "unverified" }] }, "t", { method: "totp", code: "123456" }), false);
  assert.equal(calls, 0);
});

test("a failed challenge never reaches verify", async () => {
  const seen: string[] = [];
  const call: AuthCall = async (path) => { seen.push(path); return { ok: false, json: {} }; };
  assert.equal(await verifyProof(call, user, "tok", { method: "totp", code: "123456" }), false);
  assert.deepEqual(seen, ["factors/f1/challenge"]);
});

test("an emailed code is verified for the person's own address", async () => {
  const seen: unknown[] = [];
  const call: AuthCall = async (path, body) => { seen.push([path, body]); return { ok: true, json: {} }; };
  assert.equal(await verifyProof(call, plain, "tok", { method: "email", code: "654321" }), true);
  assert.deepEqual(seen, [["verify", { type: "email", email: "a@example.com", token: "654321" }]]);
});

test("a network failure is a refusal, not a crash", async () => {
  const boom: AuthCall = async () => { throw new Error("down"); };
  assert.equal(await verifyProof(boom, plain, "tok", { method: "password", password: "pw" }), false);
  assert.equal(await sendEmailCode(boom, "a@example.com"), false);
});

test("sending a code never creates a user", async () => {
  const seen: unknown[] = [];
  await sendEmailCode(async (path, body) => { seen.push([path, body]); return { ok: true, json: {} }; }, "a@example.com");
  assert.deepEqual(seen, [["otp", { email: "a@example.com", create_user: false }]]);
});
