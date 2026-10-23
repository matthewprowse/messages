import { test } from "node:test";
import assert from "node:assert/strict";
import { hiddenReasonOf, imageSize } from "./attachment-hidden";

function png(width: number, height: number, padTo = 0) {
  const head = Buffer.alloc(24);
  head.writeUInt32BE(0x89504e47, 0);
  head.writeUInt32BE(0x0d0a1a0a, 4);
  head.writeUInt32BE(13, 8);
  head.write("IHDR", 12, "ascii");
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return Buffer.concat([head, Buffer.alloc(Math.max(0, padTo - 24))]);
}

function jpeg(width: number, height: number) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01, 0x00, 0x00, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}

const part = (over: Partial<Parameters<typeof hiddenReasonOf>[0]>) => ({
  filename: "photo.png",
  mimeType: "image/png",
  sizeBytes: 200_000,
  content: png(1200, 900),
  ...over,
});

test("reads image sizes from headers", () => {
  assert.deepEqual(imageSize(png(640, 480)), { width: 640, height: 480 });
  assert.deepEqual(imageSize(jpeg(1024, 768)), { width: 1024, height: 768 });
  const gif = Buffer.from("GIF89a\x01\x00\x01\x00", "latin1");
  assert.deepEqual(imageSize(gif), { width: 1, height: 1 });
  assert.equal(imageSize(Buffer.from("not an image")), null);
});

test("images the HTML draws are inline", () => {
  const html = '<img src="cid:Brand-Logo.png">';
  assert.equal(hiddenReasonOf(part({ filename: "brand-logo.png" }), html), "inline");
  assert.equal(hiddenReasonOf(part({ contentId: "abc@x" }), '<img src="cid:ABC@x">'), "inline");
  assert.equal(hiddenReasonOf(part({ mimeType: "text/x-amp-html", filename: "attachment" }), null), "inline");
  assert.equal(hiddenReasonOf(part({ mimeType: "text/rfc822-headers", filename: "attachment" }), null), "inline");
});

test("small images marked inline are hidden, large ones are kept", () => {
  assert.equal(hiddenReasonOf(part({ disposition: "inline", sizeBytes: 30_000 }), null), "inline");
  assert.equal(hiddenReasonOf(part({ disposition: "inline", sizeBytes: 2_000_000 }), null), null);
});

test("tiny images are hidden by size or pixels", () => {
  assert.equal(hiddenReasonOf(part({ sizeBytes: 800 }), null), "tiny");
  assert.equal(hiddenReasonOf(part({ sizeBytes: 40_000, content: png(64, 64, 40_000) }), null), "tiny");
  assert.equal(hiddenReasonOf(part({}), null), null);
});

test("small images sent as attachments stay visible", () => {
  assert.equal(hiddenReasonOf(part({ disposition: "attachment", sizeBytes: 6_000 }), null), null);
  assert.equal(hiddenReasonOf(part({ disposition: "attachment", sizeBytes: 40_000, content: png(64, 64, 40_000) }), null), null);
  assert.equal(hiddenReasonOf(part({ disposition: "attachment", contentId: "logo", sizeBytes: 800 }), null), "inline");
});

test("documents are never hidden here", () => {
  assert.equal(hiddenReasonOf(part({ filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 900, content: Buffer.from("%PDF") }), null), null);
});
