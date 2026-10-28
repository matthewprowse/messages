// Tests for crypto.ts: the v1 static-key format (round trip, fresh IV, tamper and wrong-key rejection) and the sealer
// that writes v2 under the user's key, reads both versions and ties a value to its account.

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { deriveCredentialKey } from "@messages/crypto/wrap";
import { decrypt, decryptJson, encrypt, encryptJson, makeSealer } from "./crypto";

const key = randomBytes(32).toString("base64");

test("encrypts and decrypts a round trip", () => {
  const secret = "abcd-efgh-ijkl-mnop";
  const sealed = encrypt(secret, key);
  assert.ok(sealed.startsWith("v1:"));
  assert.ok(!sealed.includes(secret));
  assert.equal(decrypt(sealed, key), secret);
});

test("the same input encrypts differently each time", () => {
  assert.notEqual(encrypt("same", key), encrypt("same", key));
});

test("rejects tampered ciphertext", () => {
  const sealed = encrypt("secret", key);
  const bytes = Buffer.from(sealed.slice(3), "base64");
  bytes[bytes.length - 1] ^= 1;
  assert.throws(() => decrypt("v1:" + bytes.toString("base64"), key));
});

test("rejects the wrong key", () => {
  const sealed = encrypt("secret", key);
  assert.throws(() => decrypt(sealed, randomBytes(32).toString("base64")));
});

test("round-trips JSON credentials", () => {
  const creds = { username: "me@icloud.com", password: "abcd-efgh", aliases: ["me@example.com"] };
  assert.deepEqual(decryptJson(encryptJson(creds, key), key), creds);
});

test("a sealer writes v2 under the user's key, reads v1 and v2, and ties a value to its account", async () => {
  const credKey = await deriveCredentialKey(Uint8Array.from(randomBytes(32)));
  const creds = { username: "me@icloud.com", password: "abcd-efgh" };
  const sealer = makeSealer("acc-1", async () => credKey, key);
  const v2 = await sealer.sealJson(creds);
  assert.ok(v2.startsWith("v2:"));
  assert.ok(!v2.includes("abcd"));
  assert.deepEqual(await sealer.openJson(v2), creds);
  assert.deepEqual(await sealer.openJson(encryptJson(creds, key)), creds); // an old row
  await assert.rejects(makeSealer("acc-2", async () => credKey, key).openJson(v2));
  await assert.rejects(makeSealer("acc-1", async () => await deriveCredentialKey(Uint8Array.from(randomBytes(32))), key).openJson(v2));
  await assert.rejects(sealer.open("v9:xx"), /Unknown ciphertext format/);
});
