// Tests for preview.ts: the worker's preview answer is read defensively and worded the way the plan says, in plain British English
// with no dashes.

import assert from "node:assert/strict";
import { test } from "node:test";
import { previewHeadline, previewNote, readPreview } from "./preview";

const parsed = JSON.stringify({ mode: "parsed", matched: 16, unreadable: 2, count: 14, leads: [{ name: "Sipho Dlamini", listing: "3 Bedroom House", at: "2026-11-01T08:00:00Z", enquiries: 2 }, { listing: "no name" }], cut: false });

test("the answer is read and entries without a name are dropped", () => {
  const p = readPreview(parsed)!;
  assert.equal(p.count, 14);
  assert.equal(p.leads.length, 1);
  assert.deepEqual(p.leads[0], { name: "Sipho Dlamini", listing: "3 Bedroom House", at: "2026-11-01T08:00:00Z", enquiries: 2 });
  assert.equal(readPreview("nope"), null);
  assert.equal(readPreview(null), null);
  assert.equal(readPreview('{"count":"x"}'), null);
});

test("the headline says how many leads a template would have made", () => {
  assert.equal(previewHeadline(readPreview(parsed)!), "In the last 30 days this would have made 14 leads.");
  assert.equal(previewHeadline({ ...readPreview(parsed)!, count: 1 }), "In the last 30 days this would have made 1 lead.");
  assert.equal(previewHeadline({ ...readPreview(parsed)!, count: 0 }), "In the last 30 days this would have made 0 leads.");
});

test("a custom automation is counted by email and says nothing was read", () => {
  const p = readPreview(JSON.stringify({ mode: "matched", matched: 3, unreadable: 0, count: 3, leads: [], cut: true }))!;
  assert.equal(previewHeadline(p), "In the last 30 days this would have run on 3 emails.");
  assert.match(previewNote(p) ?? "", /only the newest emails/);
  assert.match(previewNote(p) ?? "", /nothing is read/);
});

test("unreadable emails are explained and no wording has a dash", () => {
  const note = previewNote(readPreview(parsed)!) ?? "";
  assert.match(note, /2 matching emails could not be read/);
  assert.doesNotMatch(note + previewHeadline(readPreview(parsed)!), /[\u2013\u2014]/);
});
