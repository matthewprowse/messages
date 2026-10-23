import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blindIndex, decryptField, deriveUserKeys, encryptField, encryptOptional, isCiphertext, newDataKey } from "./index";

const vectors = JSON.parse(readFileSync(new URL("../vectors.json", import.meta.url), "utf8"));
const keys = await deriveUserKeys(Uint8Array.from(Buffer.from(vectors.dataKeyHex, "hex")));

test("encryption matches the saved vectors byte for byte, and decrypts them", async () => {
  for (const v of vectors.fields) {
    assert.equal(await encryptField(keys, v.field, v.plaintext, Uint8Array.from(v.nonce)), v.ciphertext);
    assert.equal(await decryptField(keys, v.field, v.ciphertext), v.plaintext);
  }
});

test("blind indexes match the saved vectors", async () => {
  for (const v of vectors.blindIndexes) assert.equal(await blindIndex(keys, v.value), v.token);
  assert.equal(await blindIndex(keys, "  sam@example.com "), await blindIndex(keys, "sam@example.com"));
});

test("a value moved to another field, altered, or opened with another key fails", async () => {
  const v = vectors.fields[0];
  await assert.rejects(decryptField(keys, "messages.subject", v.ciphertext));
  const bytes = Buffer.from(v.ciphertext.slice(3), "base64");
  bytes[20] ^= 1;
  await assert.rejects(decryptField(keys, v.field, `e1:${bytes.toString("base64")}`));
  await assert.rejects(decryptField(await deriveUserKeys(newDataKey()), v.field, v.ciphertext));
});

test("fresh encryptions use a new nonce each time", async () => {
  const a = await encryptField(keys, "threads.subject", "Hello");
  const b = await encryptField(keys, "threads.subject", "Hello");
  assert.notEqual(a, b);
  assert.ok(isCiphertext(a));
  assert.equal(await encryptOptional(keys, "threads.subject", null), null);
});

test("addresses are indexed by the saved rules, however they are written", async () => {
  const { addressKey, chatKey, domainKey } = await import("./addresses");
  const rule = { address: addressKey, chat: chatKey, domain: domainKey } as const;
  for (const v of vectors.addressKeys) assert.equal(rule[v.kind as keyof typeof rule](v.value), v.key);
});
