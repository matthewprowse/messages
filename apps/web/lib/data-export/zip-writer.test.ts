// zip-writer.ts: what goes in comes out unchanged when the archive is read back with fflate, text and binary alike.

import assert from "node:assert/strict";
import { test } from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { ZipWriter } from "./zip-writer";

test("text and binary files round trip", async () => {
  const zip = new ZipWriter();
  zip.add("notes/hello.md", "# Hello\n\nCafé notes");
  zip.add("files/photo.jpg", new Uint8Array([1, 2, 3, 255, 0, 7]));
  const out = unzipSync(await zip.finishBytes());
  assert.equal(strFromU8(out["notes/hello.md"]), "# Hello\n\nCafé notes");
  assert.deepEqual([...out["files/photo.jpg"]], [1, 2, 3, 255, 0, 7]);
});

test("a long repetitive text is compressed", async () => {
  const zip = new ZipWriter();
  zip.add("big.txt", "message ".repeat(50_000));
  const bytes = await zip.finishBytes();
  assert.ok(bytes.length < 20_000, `was ${bytes.length}`);
  assert.equal(strFromU8(unzipSync(bytes)["big.txt"]).length, 400_000);
});

test("an empty archive is still a valid zip", async () => {
  assert.deepEqual(Object.keys(unzipSync(await new ZipWriter().finishBytes())), []);
});

test("adding after finishing is refused", () => {
  const zip = new ZipWriter();
  zip.finish();
  assert.throws(() => zip.add("late.txt", "x"));
});
