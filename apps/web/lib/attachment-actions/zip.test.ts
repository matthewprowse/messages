// Tests for zip.ts: the CRC, the archive's layout (read back by hand), entry naming and the file name.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildZip, crc32, fitsZip, zipEntryNames, zipFileName, zipMessage } from "./zip";

const bytes = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;

test("the CRC of 123456789 is the standard check value", () => {
  assert.equal(crc32(bytes("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test("repeat names get a number, and unsafe characters are cleaned", () => {
  assert.deepEqual(zipEntryNames(["Invoice.pdf", "Invoice.pdf", "invoice.pdf", "a/b.txt"]), ["Invoice.pdf", "Invoice 2.pdf", "invoice 3.pdf", "a-b.txt"]);
});

test("the archive is named for the day, with no dashes", () => {
  assert.equal(zipFileName(new Date(2026, 10, 2)), "Konva Attachments 2 November 2026.zip");
});

test("a stored archive has its entries, sizes and end record where a reader looks", async () => {
  const blob = buildZip([{ name: "a.txt", data: bytes("hello") }, { name: "é.txt", data: bytes("") }], new Date(2026, 10, 2, 9, 30, 0));
  const view = new DataView(await blob.arrayBuffer());
  const total = view.byteLength;
  assert.equal(view.getUint32(total - 22, true), 0x06054b50);
  assert.equal(view.getUint16(total - 22 + 10, true), 2); // entries
  const centralAt = view.getUint32(total - 22 + 16, true);
  assert.equal(view.getUint32(centralAt, true), 0x02014b50);
  assert.equal(view.getUint32(centralAt + 16, true), crc32(bytes("hello")));
  assert.equal(view.getUint32(centralAt + 24, true), 5);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(6, true) & 0x0800, 0x0800);
  assert.equal(blob.type, "application/zip");
});

test("an archive over the plain ZIP limits is refused", () => {
  assert.equal(fitsZip(0, 0), false);
  assert.equal(fitsZip(3, 1_000_000), true);
  assert.equal(fitsZip(3, 4_000_000_001), false);
  assert.equal(fitsZip(70_000, 10), false);
});

test("the result says what was saved and what was left out", () => {
  assert.equal(zipMessage({ saved: 3, skipped: 0, failed: 0 }), "Downloaded 3 files.");
  assert.equal(zipMessage({ saved: 1, skipped: 2, failed: 1 }), "Downloaded 1 file (2 not stored here, 1 did not download).");
  assert.match(zipMessage({ saved: 0, skipped: 2, failed: 0, reason: "none" }), /nothing to download/);
  assert.match(zipMessage({ saved: 0, skipped: 0, failed: 0, reason: "too_big" }), /too big/);
  assert.match(zipMessage({ saved: 0, skipped: 0, failed: 2 }), /did not download/);
});
