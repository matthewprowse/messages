// Tests for backfill/files.ts: planSeal and planOpen turn a stored object into the bytes to upload and its keyed hash,
// and never seal a sealed object twice.

import { test } from "node:test";
import assert from "node:assert/strict";
import { contentHash, decryptBytes, deriveUserKeys, isSealedBytes, newDataKey } from "@messages/crypto";
import { FIELD } from "@messages/crypto/fields";
import { planOpen, planSeal } from "./files";

const keys = await deriveUserKeys(newDataKey());
const plain = new TextEncoder().encode("an old unencrypted scan") as Uint8Array<ArrayBuffer>;

test("a plain object is sealed, keyed-hashed, and opens back to the same bytes", async () => {
  const plan = await planSeal(keys, plain);
  assert.equal(plan.sealed, true);
  assert.equal(isSealedBytes(plan.upload!), true);
  assert.equal(plan.hash, await contentHash(keys, plain));
  assert.deepEqual(await decryptBytes(keys, FIELD.attachmentData, plan.upload!), plain);
});

test("an object that is already sealed is not sealed again, and still gets its hash", async () => {
  const first = await planSeal(keys, plain);
  const again = await planSeal(keys, first.upload!);
  assert.equal(again.upload, null);
  assert.equal(again.hash, first.hash);
});

test("the way back restores the plain bytes and leaves a plain object alone", async () => {
  const sealed = (await planSeal(keys, plain)).upload!;
  const back = await planOpen(keys, sealed);
  assert.deepEqual(back.upload, plain);
  assert.equal(back.sealed, false);
  assert.equal((await planOpen(keys, plain)).upload, null);
});

test("an object sealed for another kind of file does not open as an attachment", async () => {
  const { encryptBytes } = await import("@messages/crypto");
  const note = await encryptBytes(keys, FIELD.noteFileData, plain);
  await assert.rejects(planOpen(keys, note));
});
