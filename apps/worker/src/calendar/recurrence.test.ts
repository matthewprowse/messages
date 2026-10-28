// Tests for calendar/recurrence.ts. Pin down which recurrence rules are accepted, how a rule is found in Google's
// recurrence lines, and that replacing a rule keeps the skipped dates.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ruleOf, validRule, withRule } from "./recurrence";

test("validRule takes the rules the app sends and nothing else", () => {
  assert.equal(validRule("FREQ=WEEKLY;BYDAY=TU"), true);
  assert.equal(validRule("FREQ=MONTHLY;BYMONTHDAY=15"), true);
  assert.equal(validRule("FREQ=DAILY;COUNT=10"), true);
  assert.equal(validRule("FREQ=WEEKLY;UNTIL=20261231T235959Z;BYDAY=MO,TH"), true);
  assert.equal(validRule("FREQ=MONTHLY;BYDAY=-1FR"), true);
  assert.equal(validRule("RRULE:FREQ=WEEKLY"), false);
  assert.equal(validRule("FREQ=HOURLY"), false);
  assert.equal(validRule("FREQ=WEEKLY\nATTENDEE:mailto:x@example.com"), false);
  assert.equal(validRule(""), false);
});

test("ruleOf finds the rule among Google's recurrence lines", () => {
  assert.equal(ruleOf(["EXDATE;TZID=Africa/Johannesburg:20261103T090000", "RRULE:FREQ=WEEKLY;BYDAY=TU"]), "FREQ=WEEKLY;BYDAY=TU");
  assert.equal(ruleOf(["rrule:FREQ=DAILY"]), "FREQ=DAILY");
  assert.equal(ruleOf(["EXDATE:20261103T090000Z"]), null);
  assert.equal(ruleOf(undefined), null);
});

test("withRule replaces the rule and keeps skipped dates", () => {
  assert.deepEqual(withRule(["RRULE:FREQ=WEEKLY;BYDAY=TU", "EXDATE:20261103T090000Z"], "FREQ=DAILY"), ["RRULE:FREQ=DAILY", "EXDATE:20261103T090000Z"]);
  assert.deepEqual(withRule(undefined, "FREQ=YEARLY"), ["RRULE:FREQ=YEARLY"]);
});
