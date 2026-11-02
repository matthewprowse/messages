// Tests for the parts of vault.ts that need no keys: plain values pass through untouched and never ask the key service,
// and a user who signed out gets a rejection rather than blank text. The key-holding paths are covered by the crypto
// package's vectors; here the browser side of the contract is pinned.

import assert from "node:assert/strict";
import { before, test } from "node:test";
import { FIELD } from "@messages/crypto/fields";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test";
type Mod = typeof import("./vault");
let vault: Mod;
// Loaded after the fake URL is set, and not at the top: the test files are compiled as CommonJS, which has no top level await.
before(async () => {
  vault = await import("./vault");
});

test("a plain or empty value opens as itself without any keys", async () => {
  assert.equal(await vault.open(FIELD.subject, null), null);
  assert.equal(await vault.open(FIELD.subject, undefined), null);
  assert.equal(await vault.open(FIELD.subject, "hello"), "hello");
  assert.equal(await vault.open(FIELD.subject, ""), "");
});

test("sealing a null stays null", async () => {
  assert.equal(await vault.seal(FIELD.subject, null), null);
});

test("rows with no sealed text come back as the same objects, untouched", async () => {
  const rows = [{ id: "1", body: "plain" }, { id: "2", body: null }];
  const out = await vault.openRows(rows, [["body", FIELD.subject]]);
  assert.equal(out, rows);
  assert.deepEqual(out, [{ id: "1", body: "plain" }, { id: "2", body: null }]);
});

test("a sealed value with no signed-in user rejects instead of reading as empty", async () => {
  await assert.rejects(vault.open(FIELD.subject, "e1:AAAA"));
});
