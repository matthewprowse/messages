import { test } from "node:test";
import assert from "node:assert/strict";
import { contentHash, deriveUserKeys, newDataKey } from "./index";
import { encryptionOffError, ENCRYPTION_FLAGS, flagOn } from "./flags";
import { FIELD } from "./fields";

test("flags are on unless explicitly false", () => {
  for (const v of [undefined, "", "true", "TRUE", "1", "yes", "anything"]) assert.equal(flagOn(v), true, String(v));
  for (const v of ["false", "FALSE", " false ", "0", "off", "no"]) assert.equal(flagOn(v), false, v);
});

test("production refuses an explicitly off flag and names it", () => {
  const msg = encryptionOffError({ NODE_ENV: "production", ENCRYPT_CONTENT: "false", ENCRYPT_ADDRESSES: "true" }, ENCRYPTION_FLAGS);
  assert.match(msg ?? "", /ENCRYPT_CONTENT is set to false in production/);
  assert.doesNotMatch(msg ?? "", /ENCRYPT_ADDRESSES/);
  assert.match(encryptionOffError({ NODE_ENV: "production", ENCRYPT_CONTENT: "false", ENCRYPT_ADDRESSES: "false" }, ENCRYPTION_FLAGS) ?? "", /ENCRYPT_CONTENT and ENCRYPT_ADDRESSES are set/);
});

test("production starts with the flags unset or on, and development may turn them off", () => {
  assert.equal(encryptionOffError({ NODE_ENV: "production" }, ENCRYPTION_FLAGS), null);
  assert.equal(encryptionOffError({ NODE_ENV: "production", ENCRYPT_CONTENT: "true" }, ENCRYPTION_FLAGS), null);
  assert.equal(encryptionOffError({ NODE_ENV: "development", ENCRYPT_CONTENT: "false" }, ENCRYPTION_FLAGS), null);
  assert.equal(encryptionOffError({ ENCRYPT_CONTENT: "false" }, ENCRYPTION_FLAGS), null);
});

test("every field name is unique, so one kind of text cannot open as another", () => {
  const names = Object.values(FIELD);
  assert.equal(new Set(names).size, names.length);
});

test("a content hash is stable for one user, differs between users and between files, and is not a plain hash", async () => {
  const a = await deriveUserKeys(newDataKey());
  const b = await deriveUserKeys(newDataKey());
  const file = new TextEncoder().encode("the same pdf") as Uint8Array<ArrayBuffer>;
  const other = new TextEncoder().encode("another pdf") as Uint8Array<ArrayBuffer>;
  const h = await contentHash(a, file);
  assert.equal(h, await contentHash(a, file));
  assert.notEqual(h, await contentHash(b, file));
  assert.notEqual(h, await contentHash(a, other));
  const sha = Buffer.from(await crypto.subtle.digest("SHA-256", file)).toString("base64url");
  assert.notEqual(h, sha);
  assert.match(h, /^[A-Za-z0-9_-]{43}$/);
});
