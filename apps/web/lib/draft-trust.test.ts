// Tests for draft-trust.ts: the report and audit are read defensively, and the audit reads as one plain line.

import assert from "node:assert/strict";
import { test } from "node:test";
import { auditLine, checkSummary, parseAudit, parseReport } from "./draft-trust";

test("a report is read back, and a broken one is ignored", () => {
  const r = parseReport('{"facts":[{"kind":"amount","text":"R4,500","found":false},{"kind":"time","text":"14:00","found":true}],"placeholders":["[Name]"],"missing":2}');
  assert.equal(r?.facts.length, 2);
  assert.equal(checkSummary(r), "Check 2 details before sending");
  assert.equal(parseReport("not json"), undefined);
  assert.equal(parseReport('{"facts":1}'), undefined);
  assert.equal(parseReport(null), undefined);
});

test("nothing to check says nothing", () => {
  assert.equal(checkSummary(parseReport('{"facts":[{"kind":"time","text":"14:00","found":true}],"placeholders":[],"missing":0}')), null);
  assert.equal(checkSummary(undefined), null);
});

test("the audit reads as one line of counts", () => {
  const a = parseAudit({ messages: 3, facts: 2, rules: 0, replies: 0, note: false, calendar: true });
  assert.equal(auditLine(a), "Based on: last 3 messages, 2 saved facts, your calendar");
  assert.equal(auditLine(parseAudit({ messages: 1, facts: 1 })), "Based on: the last message, 1 saved fact");
  assert.equal(auditLine(parseAudit(null)), "");
  assert.equal(auditLine(parseAudit({})), "");
});
