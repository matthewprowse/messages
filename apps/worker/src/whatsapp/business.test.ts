// business.ts: a business profile means a Business account, a missing one or a 404 means personal, and any other failure is "unknown".

import assert from "node:assert/strict";
import { test } from "node:test";
import { isBusinessAccount } from "./business";

const sock = (lookup: () => Promise<unknown>) => ({ user: { id: "27821234567:3@s.whatsapp.net" }, getBusinessProfile: lookup as never });

test("a business profile is a Business account", async () => {
  assert.equal(await isBusinessAccount(sock(async () => ({ wid: "x" }))), true);
});

test("no profile, or a not found answer, is a personal account", async () => {
  assert.equal(await isBusinessAccount(sock(async () => undefined)), false);
  assert.equal(await isBusinessAccount(sock(async () => { throw Object.assign(new Error("x"), { output: { statusCode: 404 } }); })), false);
});

test("any other failure, or no linked user yet, is unknown", async () => {
  assert.equal(await isBusinessAccount(sock(async () => { throw new Error("timed out"); })), null);
  assert.equal(await isBusinessAccount({ user: null, getBusinessProfile: (async () => ({})) as never }), null);
});
