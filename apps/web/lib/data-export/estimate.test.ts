// estimate.ts: the size line under Include Files, with the warning for a large archive.

import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateText, LARGE_BYTES, totalUsage } from "./estimate";

test("usage rows add up, whatever type the database returned the numbers in", () => {
  assert.deepEqual(totalUsage([{ kind: "image", files: 3, bytes: 100 }, { kind: "pdf", files: "2" as unknown as number, bytes: "50" as unknown as number }]), { files: 5, bytes: 150 });
  assert.deepEqual(totalUsage([]), { files: 0, bytes: 0 });
});

test("the line says how many files and how big", () => {
  assert.equal(estimateText({ files: 1, bytes: 2048 }), "1 file, about 2 KB.");
  assert.equal(estimateText({ files: 1200, bytes: 300 * 1024 ** 2 }), "1,200 files, about 300 MB.");
});

test("no files, and nothing known yet, have their own lines", () => {
  assert.match(estimateText({ files: 0, bytes: 0 }), /adds nothing/);
  assert.match(estimateText(null), /Add every/);
});

test("a very large archive is warned about", () => {
  assert.match(estimateText({ files: 9000, bytes: LARGE_BYTES }), /use a computer/);
  assert.doesNotMatch(estimateText({ files: 9000, bytes: LARGE_BYTES - 1 }), /use a computer/);
});

test("the text has no dashes", () => {
  assert.doesNotMatch(estimateText({ files: 9000, bytes: LARGE_BYTES }), /[–—]/);
});
