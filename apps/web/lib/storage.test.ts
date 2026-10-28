// Tests for storage.ts: the storage notice levels at 80% and 100%, the team cap, and mimeFor from file-types.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { STORAGE_CAP_BYTES, bytesLabel, storageLevel } from "./storage";
import { mimeFor } from "./file-types";

test("storage shows nothing under 80%, a notice from 80%, and full from 100%", () => {
  const cap = STORAGE_CAP_BYTES;
  assert.equal(storageLevel(0, cap), "ok");
  assert.equal(storageLevel(cap * 0.799, cap), "ok");
  assert.equal(storageLevel(cap * 0.8, cap), "near");
  assert.equal(storageLevel(cap * 0.999, cap), "near");
  assert.equal(storageLevel(cap, cap), "full");
  assert.equal(storageLevel(5, 0), "ok");
});

test("a team of five has 100 GB", () => {
  assert.equal(storageLevel(79 * 1024 ** 3, 5 * STORAGE_CAP_BYTES), "ok");
  assert.equal(storageLevel(85 * 1024 ** 3, 5 * STORAGE_CAP_BYTES), "near");
  assert.equal(bytesLabel(5 * STORAGE_CAP_BYTES), "100.0 GB");
});

test("an opened attachment gets its type from its name, then its kind", () => {
  assert.equal(mimeFor({ name: "Photo.JPG", kind: "image" }), "image/jpeg");
  assert.equal(mimeFor({ name: "Voice Note.ogg", kind: "audio" }), "audio/ogg");
  assert.equal(mimeFor({ name: "Sticker.webp", kind: "image" }), "image/webp");
  assert.equal(mimeFor({ name: "scan", kind: "pdf" }), "application/pdf");
  assert.equal(mimeFor({ name: "notes.xyz", kind: "file" }), "application/octet-stream");
});
