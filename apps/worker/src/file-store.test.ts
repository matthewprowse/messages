// Tests for file-store.ts (keepFile): sealing and keyed hashing before upload, one stored copy per account, and the video, cap and
// 50 MB rules, run against in-memory fakes for storage and the database.

import { test } from "node:test";
import assert from "node:assert/strict";
import { contentHash, decryptBytes, deriveUserKeys, isSealedBytes, newDataKey } from "@messages/crypto";
import { FIELD } from "@messages/crypto/fields";

process.env.SUPABASE_URL ??= "http://127.0.0.1:1";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test";
process.env.ENCRYPTION_KEY ??= "test";

const { keepFile } = await import("./file-store");
type Deps = Parameters<typeof keepFile>[1];

const keys = await deriveUserKeys(newDataKey());
const bytes = Buffer.from("%PDF-1.7 a receipt for the plumber");

function harness(over: Partial<NonNullable<Deps>> = {}) {
  const log = { uploads: [] as { path: string; bytes: Buffer; type: string }[], updates: [] as { id: string; patch: Record<string, unknown>; onlyUnsaved?: boolean }[], saved: 0 };
  const deps: NonNullable<Deps> = {
    encrypting: true,
    keys: async () => keys,
    state: async () => "open",
    saved: async (_u, n) => void (log.saved += n),
    upload: async (path, b, type) => void log.uploads.push({ path, bytes: b, type }),
    copy: async () => null,
    update: async (id, patch, onlyUnsaved) => void log.updates.push({ id, patch, onlyUnsaved }),
    ...over,
  };
  return { deps, log };
}
const file = { userId: "u", accountId: "a", messageId: "m", attachmentId: "x", kind: "pdf", mimeType: "application/pdf", bytes };

test("a file is sealed before upload, opens with the user's key, and records a keyed hash", async () => {
  const { deps, log } = harness();
  const kept = await keepFile(file, deps);
  assert.deepEqual(kept, { saved: true, path: "u/m/x", reused: false });
  const [up] = log.uploads;
  assert.equal(up.type, "application/octet-stream");
  assert.equal(isSealedBytes(up.bytes), true);
  assert.equal(up.bytes.includes(Buffer.from("receipt for the plumber")), false);
  assert.equal(Buffer.from(await decryptBytes(keys, FIELD.attachmentData, new Uint8Array(up.bytes))).toString(), bytes.toString());
  const patch = log.updates[0].patch;
  assert.equal(patch.sealed, true);
  assert.equal(patch.content_hash, await contentHash(keys, new Uint8Array(bytes)));
  assert.equal(patch.storage_path, "u/m/x");
  assert.equal(log.saved, bytes.length);
});

test("a sealed file does not open as a note file or any other kind of data", async () => {
  const { deps, log } = harness();
  await keepFile(file, deps);
  await assert.rejects(decryptBytes(keys, FIELD.noteFileData, new Uint8Array(log.uploads[0].bytes)));
});

test("with encryption off the file is stored as it is, and still hashed", async () => {
  const { deps, log } = harness({ encrypting: false });
  await keepFile(file, deps);
  assert.equal(log.uploads[0].bytes.equals(bytes), true);
  assert.equal(log.uploads[0].type, "application/pdf");
  assert.equal(log.updates[0].patch.sealed, false);
  assert.equal(typeof log.updates[0].patch.content_hash, "string");
});

test("the same file again in the account reuses the stored object and uploads nothing", async () => {
  const { deps, log } = harness({ copy: async () => ({ storage_path: "u/m0/x0", sealed: true }) });
  const kept = await keepFile({ ...file, attachmentId: "y" }, deps);
  assert.deepEqual(kept, { saved: true, path: "u/m0/x0", reused: true });
  assert.equal(log.uploads.length, 0);
  assert.equal(log.saved, 0);
  assert.equal(log.updates[0].patch.storage_path, "u/m0/x0");
  assert.equal(log.updates[0].patch.sealed, true);
});

test("a video over 25 MB is not copied and is marked video_link", async () => {
  const { deps, log } = harness();
  const big = Buffer.alloc(25 * 1024 * 1024 + 1);
  const kept = await keepFile({ ...file, kind: "video", mimeType: "video/mp4", bytes: big }, deps);
  assert.deepEqual(kept, { saved: false, reason: "video_link" });
  assert.equal(log.uploads.length, 0);
  assert.deepEqual(log.updates[0], { id: "x", patch: { not_kept: "video_link" }, onlyUnsaved: true });
});

test("a small video is copied", async () => {
  const { deps, log } = harness();
  const kept = await keepFile({ ...file, kind: "video", mimeType: "video/mp4", bytes: Buffer.alloc(1024) }, deps);
  assert.equal(kept.saved, true);
  assert.equal(log.uploads.length, 1);
});

test("a full seat saves nothing and marks over_cap; the original stays at the provider", async () => {
  const { deps, log } = harness({ state: async () => "full" });
  assert.deepEqual(await keepFile(file, deps), { saved: false, reason: "over_cap" });
  assert.equal(log.uploads.length, 0);
  assert.equal(log.updates[0].patch.not_kept, "over_cap");
});

test("in the grace band a message that has started still finishes, a new one does not", async () => {
  const grace = harness({ state: async () => "grace" });
  assert.equal((await keepFile({ ...file, messageStarted: true }, grace.deps)).saved, true);
  const refused = harness({ state: async () => "grace" });
  assert.deepEqual(await keepFile({ ...file, messageStarted: false }, refused.deps), { saved: false, reason: "over_cap" });
});

test("a duplicate costs no space even when the seat is full", async () => {
  const { deps, log } = harness({ state: async () => "full", copy: async () => ({ storage_path: "u/m0/x0", sealed: true }) });
  assert.equal((await keepFile(file, deps)).saved, true);
  assert.equal(log.uploads.length, 0);
});

test("a file over 50 MB is skipped", async () => {
  const { deps, log } = harness();
  const kept = await keepFile({ ...file, kind: "file", bytes: Buffer.alloc(50 * 1024 * 1024 + 1) }, deps);
  assert.deepEqual(kept, { saved: false, reason: "too_large" });
  assert.equal(log.updates.length, 0);
});

test("with encryption on and no keys the file is not stored at all", async () => {
  const { deps, log } = harness({ keys: async () => null });
  await assert.rejects(keepFile(file, deps), (err: unknown) => (err as { code?: string }).code === "NO_KEYS");
  assert.equal(log.uploads.length, 0);
  assert.equal(log.updates.length, 0);
});

test("with encryption off and no keys the file is stored as it is, without a hash", async () => {
  const { deps, log } = harness({ encrypting: false, keys: async () => null });
  await keepFile(file, deps);
  assert.equal(log.uploads[0].bytes.equals(bytes), true);
  assert.equal(log.updates[0].patch.content_hash, null);
});
