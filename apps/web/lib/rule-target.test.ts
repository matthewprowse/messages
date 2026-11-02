// Pins down normaliseRuleTarget: the forms people type for a priority rule all land on the form senders are matched on.

import test from "node:test";
import assert from "node:assert/strict";
import { normaliseRuleTarget } from "./rule-target";

const value = (s: string) => { const r = normaliseRuleTarget(s); return r.ok ? r.value : null; };

test("addresses and domains are lower case, and a leading @ means a domain", () => {
  assert.equal(value("  Thandi@Company.CO.ZA "), "thandi@company.co.za");
  assert.equal(value("@Company.co.za"), "company.co.za");
  assert.equal(value("Example.com"), "example.com");
});

test("South African numbers come out as +27 however they are written", () => {
  assert.equal(value("082 123 4567"), "+27821234567");
  assert.equal(value("+27 82 123 4567"), "+27821234567");
  assert.equal(value("27821234567"), "+27821234567");
  assert.equal(value("0027821234567"), "+27821234567");
});

test("text that is none of the three is refused with a sentence", () => {
  assert.equal(value("hello"), null);
  assert.equal(value(""), null);
  const r = normaliseRuleTarget("not a sender");
  assert.ok(!r.ok && r.error.includes("+27"));
});
