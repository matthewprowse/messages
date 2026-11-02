// Tests for photos/pdf-thumbnail.ts: a one-page PDF becomes a small JPEG, and anything that is not a readable PDF gives null.

import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { makePdfThumbnail, PDF_THUMB_MAX_BYTES } from "./pdf-thumbnail";
import { THUMB_SIZE } from "./thumbnail";

/** A minimal one-page PDF with a filled rectangle, written by hand so the test needs no PDF library. */
function tinyPdf(width: number, height: number): Buffer {
  const content = "1 0 0 rg 20 20 100 100 re f";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

test("a one-page PDF becomes a JPEG no larger than the thumbnail size, keeping the page shape", async () => {
  const thumb = await makePdfThumbnail(tinyPdf(300, 400));
  assert.ok(thumb);
  const meta = await sharp(thumb).metadata();
  assert.equal(meta.format, "jpeg");
  assert.ok(Math.max(meta.width ?? 0, meta.height ?? 0) <= THUMB_SIZE);
  assert.ok((meta.height ?? 0) > (meta.width ?? 0));
});

test("bytes that are not a PDF, empty bytes and an oversized file give null", async () => {
  assert.equal(await makePdfThumbnail(Buffer.from("this is not a pdf")), null);
  assert.equal(await makePdfThumbnail(new Uint8Array(0)), null);
  assert.equal(await makePdfThumbnail(new Uint8Array(PDF_THUMB_MAX_BYTES + 1)), null);
});
