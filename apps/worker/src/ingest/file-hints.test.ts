// Tests for ingest/file-hints.ts. Pin down the file extension rules, which names are kept out of Junk (receipts,
// invoices) and how a WhatsApp sticker is recognised.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileHints } from "./file-hints";

test("the extension is lower case, up to eight characters, or none", () => {
  assert.equal(fileHints("Invoice.PDF").ext, "pdf");
  assert.equal(fileHints("invite.ics").ext, "ics");
  assert.equal(fileHints("archive.tar.gz").ext, "gz");
  assert.equal(fileHints("README").ext, null);
  assert.equal(fileHints("weird.extensionlong").ext, null);
});

test("a name that reads like a receipt or invoice is kept out of Junk", () => {
  for (const name of ["Invoice 4411.pdf", "boarding-pass.pdf", "Payslip May.pdf", "Rechnung.pdf", "tax return.pdf", "Receipt.PDF"]) assert.equal(fileHints(name).keep, true, name);
  for (const name of ["holiday.jpg", "banner.png", "Photo.jpg"]) assert.equal(fileHints(name).keep, false, name);
});

test("a WhatsApp sticker is named Sticker", () => {
  assert.equal(fileHints("Sticker.webp").sticker, true);
  assert.equal(fileHints("sticker.webp").sticker, true);
  assert.equal(fileHints("My Sticker.webp").sticker, false);
  assert.equal(fileHints("Photo.jpg").sticker, false);
});
