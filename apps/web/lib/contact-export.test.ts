// Tests for lib/contact-export.ts safeCell: a cell a spreadsheet could run as a formula is written as text. The round trip
// through import is tested in contact-import.test.ts.

import test from "node:test";
import assert from "node:assert/strict";
import { safeCell, toCsv } from "./contact-export";

test("a cell led by a tab or carriage return gets an apostrophe, like one led by = or @", () => {
  assert.equal(safeCell("\t=cmd|' /C calc'!A0"), "'\t=cmd|' /C calc'!A0");
  assert.equal(safeCell("\r=1+1"), "'\r=1+1");
  assert.equal(safeCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(safeCell("Sipho\tDlamini"), "Sipho\tDlamini");
});

test("a phone number keeps its plus and a plain name is untouched", () => {
  assert.equal(safeCell("+27 82 123 4567"), "+27 82 123 4567");
  assert.equal(safeCell("Thandi"), "Thandi");
});

test("a carriage return led cell is quoted in the CSV with its apostrophe inside", () => {
  const csv = toCsv([{ name: "\r=1+1", emails: [], phones: [], company: "", role: "", relationship: "", about: "", vip: false }]);
  assert.ok(csv.split("\r\n")[1].startsWith("\"'\r=1+1\","));
});
