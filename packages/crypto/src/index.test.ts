import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blindIndex, decryptBytes, decryptField, encryptBytes, isSealedBytes, deriveUserKeys, encryptField, encryptOptional, isCiphertext, newDataKey } from "./index";

const vectors = JSON.parse(readFileSync(new URL("../vectors.json", import.meta.url), "utf8"));
const FILE_VECTOR = "6531623a00ff4b4e32333435363738393a3b3c3d43c5de354faa82729b486ed50c6d879e3fdd4418a1cd5b6d362a";
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

test("sealed file bytes match the saved vector, open again, and are recognised by their header", async () => {
  const plain = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0, 255, 1, 2, 3]);
  const nonce = Uint8Array.from({ length: 12 }, (_, i) => 50 + i);
  const sealed = await encryptBytes(keys, "note_file_data", plain, nonce);
  assert.equal(Buffer.from(sealed).toString("hex"), FILE_VECTOR);
  assert.ok(isSealedBytes(sealed));
  assert.ok(!isSealedBytes(plain));
  assert.ok(!isSealedBytes(new Uint8Array(0)));
  assert.deepEqual(await decryptBytes(keys, "note_file_data", sealed), plain);
  assert.deepEqual(await decryptBytes(keys, "note_file_data", await encryptBytes(keys, "note_file_data", new Uint8Array(0))), new Uint8Array(0));
});

test("sealed file bytes fail when moved to another field, altered, cut short, opened with another key or not sealed", async () => {
  const sealed = await encryptBytes(keys, "note_file_data", Uint8Array.from([1, 2, 3, 4]));
  await assert.rejects(decryptBytes(keys, "note_file", sealed));
  const altered = Uint8Array.from(sealed);
  altered[sealed.length - 1] ^= 1;
  await assert.rejects(decryptBytes(keys, "note_file_data", altered));
  await assert.rejects(decryptBytes(keys, "note_file_data", sealed.slice(0, 30)));
  await assert.rejects(decryptBytes(await deriveUserKeys(newDataKey()), "note_file_data", sealed));
  await assert.rejects(decryptBytes(keys, "note_file_data", Uint8Array.from([1, 2, 3, 4])));
  const a = await encryptBytes(keys, "note_file_data", Uint8Array.from([9]));
  const b = await encryptBytes(keys, "note_file_data", Uint8Array.from([9]));
  assert.notDeepEqual(a, b);
});
