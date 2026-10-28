// Tests for the thumbnail beside a saved photo (file-store.ts keepFile) and the backfill of older photos (missing-files.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { decryptBytes, deriveUserKeys, encryptBytes, isSealedBytes, newDataKey } from "@messages/crypto";
import { FIELD } from "@messages/crypto/fields";

process.env.SUPABASE_URL ??= "http://127.0.0.1:1";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test";
process.env.ENCRYPTION_KEY ??= "test";

const { keepFile } = await import("./file-store");
const { backfillThumbnails, NO_THUMB } = await import("./missing-files");
type Deps = NonNullable<Parameters<typeof keepFile>[1]>;

const keys = await deriveUserKeys(newDataKey());
const image = await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 10, g: 120, b: 200 } } }).jpeg().toBuffer();

function harness(over: Partial<Deps> = {}) {
  const uploads: { path: string; bytes: Buffer }[] = [];
  const thumbs: { id: string; path: string }[] = [];
  const deps: Deps = {
    encrypting: true,
    keys: async () => keys,
    state: async () => "open",
    saved: async () => {},
    upload: async (path, bytes) => void uploads.push({ path, bytes }),
    copy: async () => null,
    update: async () => {},
    setThumb: async (id, path) => void thumbs.push({ id, path }),
    ...over,
  };
  return { deps, uploads, thumbs };
}
const photo = { userId: "u", accountId: "a", messageId: "m", attachmentId: "x", kind: "image", mimeType: "image/jpeg", bytes: image };

test("a saved photo gets a sealed 256 px thumbnail beside it, recorded on the row", async () => {
  const { deps, uploads, thumbs } = harness();
  await keepFile(photo, deps);
  assert.deepEqual(uploads.map((u) => u.path), ["u/m/x", "u/m/x.thumb"]);
  assert.equal(isSealedBytes(uploads[1].bytes), true);
  const plain = await decryptBytes(keys, FIELD.attachmentData, new Uint8Array(uploads[1].bytes));
  assert.equal((await sharp(plain).metadata()).width, 256);
  assert.ok(uploads[1].bytes.length < uploads[0].bytes.length / 3);
  assert.deepEqual(thumbs, [{ id: "x", path: "u/m/x.thumb" }]);
});

test("no thumbnail for a PDF, an unreadable image, or when encryption is off", async () => {
  for (const [file, over] of [
    [{ ...photo, kind: "pdf", mimeType: "application/pdf" }, {}],
    [{ ...photo, bytes: Buffer.from("broken") }, {}],
    [photo, { encrypting: false }],
  ] as const) {
    const { deps, uploads, thumbs } = harness(over);
    const kept = await keepFile(file, deps);
    assert.equal(kept.saved, true);
    assert.equal(uploads.length, 1);
    assert.equal(thumbs.length, 0);
  }
});

test("a thumbnail that fails to save never fails the file", async () => {
  const { deps } = harness({ setThumb: async () => { throw new Error("no column"); } });
  assert.deepEqual(await keepFile(photo, deps), { saved: true, path: "u/m/x", reused: false });
  const { deps: noUpload } = harness({ upload: async (path) => { if (path.endsWith(".thumb")) throw new Error("storage"); } });
  assert.equal((await keepFile(photo, noUpload)).saved, true);
});

test("the backfill thumbnails old sealed photos, marks unreadable ones, and leaves failures for the next pass", async () => {
  const sealedPhoto = await encryptBytes(keys, FIELD.attachmentData, new Uint8Array(image));
  const sealedJunk = await encryptBytes(keys, FIELD.attachmentData, new TextEncoder().encode("not an image"));
  const stored: Record<string, Uint8Array<ArrayBuffer> | null> = { "u/m/a": sealedPhoto, "u/m/b": sealedJunk, "u/m/c": null, "u/m/d": sealedPhoto };
  const written: { id: string; path: string }[] = [];
  const uploaded: string[] = [];
  const result = await backfillThumbnails(10, {
    list: async (limit) => Object.keys(stored).slice(0, limit).map((p) => ({ id: p.slice(-1), user_id: "u", storage_path: p })),
    keys: async () => keys,
    download: async (p) => stored[p],
    upload: async (p, bytes) => {
      if (p === "u/m/d.thumb") throw new Error("storage down");
      assert.equal(isSealedBytes(bytes), true);
      uploaded.push(p);
    },
    setThumb: async (id, path) => void written.push({ id, path }),
  });
  assert.equal(result, 1);
  assert.deepEqual(uploaded, ["u/m/a.thumb"]);
  assert.deepEqual(written, [{ id: "a", path: "u/m/a.thumb" }, { id: "b", path: NO_THUMB }, { id: "c", path: NO_THUMB }]);
});

test("the backfill does at most the limit", async () => {
  let asked = 0;
  await backfillThumbnails(3, { list: async (n) => { asked = n; return []; }, keys: async () => keys, download: async () => null, upload: async () => {}, setThumb: async () => {} });
  assert.equal(asked, 3);
});
