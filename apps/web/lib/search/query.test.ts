// Tests for query.ts: words, phrases and each operator, and what happens to text that only looks like an operator.

import test from "node:test";
import assert from "node:assert/strict";
import { parseDay, parseQuery, plainText } from "./query";

const NOW = new Date(2026, 10, 2, 15, 0); // 2 November 2026, local time
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

test("plain words are folded and kept in order", () => {
  const q = parseQuery("  Invoice   Zoë ", NOW);
  assert.deepEqual(q.terms, ["invoice", "zoe"]);
  assert.equal(q.hasOperators, false);
  assert.equal(q.empty, false);
});

test("an empty box is empty, and an operator alone is not", () => {
  assert.equal(parseQuery("   ", NOW).empty, true);
  assert.equal(parseQuery("is:unread", NOW).empty, false);
});

test("a quoted phrase stays together", () => {
  const q = parseQuery('"Annual Report" draft', NOW);
  assert.deepEqual(q.phrases, ["annual report"]);
  assert.deepEqual(q.terms, ["draft"]);
});

test("from and to take a word or a quoted name, and can repeat", () => {
  const q = parseQuery('from:jane to:"Bob Smith" to:acme.com budget', NOW);
  assert.deepEqual(q.from, ["jane"]);
  assert.deepEqual(q.to, ["bob smith", "acme.com"]);
  assert.deepEqual(q.terms, ["budget"]);
});

test("has:attachment and is:unread switch their filters on, whatever the case", () => {
  const q = parseQuery("HAS:Attachment Is:Unread", NOW);
  assert.equal(q.hasAttachment, true);
  assert.equal(q.unread, true);
  assert.deepEqual(q.terms, []);
});

test("an operator with a value it does not know is plain text", () => {
  const q = parseQuery("has:pizza is:happy", NOW);
  assert.equal(q.hasAttachment, false);
  assert.deepEqual(q.terms, ["has:pizza", "is:happy"]);
});

test("times and links are not read as operators", () => {
  assert.deepEqual(parseQuery("10:30 https://example.com", NOW).terms, ["10:30", "https://example.com"]);
});

test("before and after read a local day", () => {
  const q = parseQuery("before:2026-11-02 after:2026/10/01", NOW);
  assert.equal(q.before, day(2026, 11, 2));
  assert.equal(q.after, day(2026, 10, 1));
});

test("days can be a month, a year, today or yesterday, and a day that does not exist is dropped", () => {
  assert.equal(parseDay("2026-03", NOW), day(2026, 3, 1));
  assert.equal(parseDay("2025", NOW), day(2025, 1, 1));
  assert.equal(parseDay("today", NOW), day(2026, 11, 2));
  assert.equal(parseDay("Yesterday", NOW), day(2026, 11, 1));
  assert.equal(parseDay("2026-02-31", NOW), null);
  assert.equal(parseDay("soon", NOW), null);
  const q = parseQuery("after:2026-02-31 invoice", NOW);
  assert.equal(q.after, undefined);
  assert.equal(q.hasOperators, true);
});

test("plainText joins words and phrases for the simple list filter", () => {
  assert.equal(plainText(parseQuery('from:jane "big deal" budget', NOW)), "budget big deal");
});
