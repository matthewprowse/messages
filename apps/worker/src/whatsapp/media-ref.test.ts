// Tests for whatsapp/media-ref.ts: the parts of a stored file reference that let someone fetch the file are stored
// sealed and come back whole, the type stays plain, and a reference stored plain before that still opens.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { StoredMedia } from "./media";
import { openMediaRef, sealMediaRef } from "./media-ref";

const ref: StoredMedia = { type: "imageMessage", url: null, direct_path: "/v/t62/x_n.enc?a=1", media_key: "a2V5", file_enc_sha256: "ZW5j", file_sha256: "c2hh", mimetype: "image/jpeg" };
const vault = {
  seal: async (_user: string, field: string, value: string) => `sealed:${field}:${value}`,
  open: async (_user: string, field: string, value: string) => (value.startsWith(`sealed:${field}:`) ? value.slice(`sealed:${field}:`.length) : null),
};

test("the path, key and hashes are sealed and round-trip, and the type stays plain", async () => {
  const stored = await sealMediaRef(vault, "user-1", ref);
  assert.equal(stored.type, "imageMessage");
  assert.equal(stored.mimetype, "image/jpeg");
  assert.equal(stored.media_key, null);
  assert.equal(stored.direct_path, null);
  assert.ok(stored.sealed?.startsWith("sealed:quote:"));
  assert.notEqual(stored.sealed, undefined);
  assert.deepEqual(await openMediaRef(vault, "user-1", stored), { ...ref, sealed: stored.sealed });
});

test("a reference stored plain before sealing opens as it is, and an unreadable one fetches nothing", async () => {
  assert.deepEqual(await openMediaRef(vault, "user-1", ref), ref);
  const opened = await openMediaRef(vault, "user-1", { ...ref, sealed: "garbage" });
  assert.equal(opened.media_key, null);
  assert.equal(opened.direct_path, null);
});
