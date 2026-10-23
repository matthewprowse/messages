import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeQr, qrToSvgPath, qrToTerminal } from "@messages/qr";

// Scanning was checked separately by decoding generated codes with macOS Vision. These guard the shape.

test("sizes grow with the text", () => {
  assert.equal(encodeQr("hi").length, 21);
  const wa = "2@" + "a".repeat(200);
  assert.equal(encodeQr(wa).length, 57); // version 10 at level M
});

test("finder patterns sit in three corners", () => {
  const m = encodeQr("hello");
  const n = m.length;
  for (const [x, y] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
    assert.equal(m[y][x], true);
    assert.equal(m[y + 1][x + 1], false);
    assert.equal(m[y + 3][x + 3], true);
  }
  assert.equal(m[n - 8][8], true); // the dark module
});

test("renders for a terminal and as an SVG path", () => {
  const m = encodeQr("x");
  assert.equal(qrToTerminal(m).split("\n").length, Math.ceil((m.length + 4) / 2));
  assert.match(qrToSvgPath(m), /^M\d+ \d+h1v1h-1z/);
});
