// Tests for photos/thumbnail.ts: a photo becomes a small upright JPEG, and anything unreadable or too large gives null.

import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { canThumbnail, makeThumbnail, THUMB_SIZE, thumbPathFor } from "./thumbnail";

const photo = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } } }).png().toBuffer();

test("a large photo becomes a JPEG of 256 px on the long side, keeping its shape and a small size", async () => {
  const thumb = await makeThumbnail(await photo(2000, 1000));
  assert.ok(thumb);
  const meta = await sharp(thumb).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.width, THUMB_SIZE);
  assert.equal(meta.height, THUMB_SIZE / 2);
  assert.ok(thumb.length < 20_000);
});

test("a small photo is not blown up", async () => {
  const meta = await sharp((await makeThumbnail(await photo(100, 60)))!).metadata();
  assert.deepEqual([meta.width, meta.height], [100, 60]);
});

test("a photo that is not an image, or has too many pixels, gives null", async () => {
  assert.equal(await makeThumbnail(Buffer.from("not a picture at all")), null);
  assert.equal(await makeThumbnail(await photo(5000, 4000)), null); // 20 MP, over the 16.7 MP bound
});

test("many photos at once all finish (the decode queue releases)", async () => {
  const src = await photo(600, 600);
  const all = await Promise.all(Array.from({ length: 8 }, () => makeThumbnail(src)));
  assert.ok(all.every((t) => t && t.length > 0));
});

test("which types get one, and where it is stored", () => {
  assert.equal(canThumbnail("image/jpeg"), true);
  assert.equal(canThumbnail("image/heic"), true);
  assert.equal(canThumbnail(null), true);
  assert.equal(canThumbnail("image/svg+xml"), false);
  assert.equal(canThumbnail("application/pdf"), false);
  assert.equal(thumbPathFor("u/m/a"), "u/m/a.thumb");
});
