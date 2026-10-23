import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decrypt, decryptJson, encrypt, encryptJson } from "./crypto";

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
