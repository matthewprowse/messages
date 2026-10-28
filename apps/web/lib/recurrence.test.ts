import assert from "node:assert/strict";
import { test } from "node:test";
import { describeRule, ordinal, repeatChoices, sameRepeat, sameRule } from "./recurrence";

// Tuesday 3 November 2026.
const TUESDAY = new Date(2026, 10, 3, 9, 0);

test("describeRule says how an event repeats", () => {
  assert.equal(describeRule("FREQ=DAILY"), "Every Day");
  assert.equal(describeRule("FREQ=DAILY;INTERVAL=3"), "Every 3 Days");
  assert.equal(describeRule("FREQ=WEEKLY;BYDAY=TU"), "Every Week on Tuesday");
  assert.equal(describeRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH"), "Every 2 Weeks on Monday and Thursday");
  assert.equal(describeRule("FREQ=WEEKLY;BYDAY=MO,WE,FR"), "Every Week on Monday, Wednesday and Friday");
  assert.equal(describeRule("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"), "Every Weekday");
  assert.equal(describeRule("FREQ=DAILY;BYDAY=FR,MO,TU,WE,TH"), "Every Weekday");
  assert.equal(describeRule("FREQ=MONTHLY;BYMONTHDAY=15"), "Every Month on the 15th");
  assert.equal(describeRule("FREQ=MONTHLY;BYMONTHDAY=-1"), "Every Month on the Last Day");
  assert.equal(describeRule("FREQ=MONTHLY;BYDAY=1MO"), "Every Month on the First Monday");
  assert.equal(describeRule("FREQ=MONTHLY;INTERVAL=2;BYDAY=-1FR"), "Every 2 Months on the Last Friday");
  assert.equal(describeRule("FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=3"), "Every Year on 3 March");
});

test("describeRule ends with a count or an end date", () => {
  assert.equal(describeRule("FREQ=DAILY;COUNT=10"), "Every Day, 10 Times");
  assert.equal(describeRule("FREQ=WEEKLY;UNTIL=20261231T215959Z;BYDAY=TU"), "Every Week on Tuesday, Until 31 December 2026");
  assert.equal(describeRule("FREQ=YEARLY;UNTIL=20300101"), "Every Year, Until 1 January 2030");
});

test("describeRule fills in from the first occurrence what a rule leaves to it", () => {
  assert.equal(describeRule("FREQ=WEEKLY", TUESDAY), "Every Week on Tuesday");
  assert.equal(describeRule("FREQ=MONTHLY", TUESDAY), "Every Month on the 3rd");
  assert.equal(describeRule("FREQ=YEARLY", TUESDAY), "Every Year on 3 November");
  assert.equal(describeRule("RRULE:FREQ=WEEKLY;WKST=SU;BYDAY=TU"), "Every Week on Tuesday");
});

test("describeRule says only Repeats for what it cannot put in words", () => {
  assert.equal(describeRule("FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=-1"), "Repeats");
  assert.equal(describeRule("FREQ=HOURLY"), "Repeats");
  assert.equal(describeRule("FREQ=WEEKLY;BYDAY=XX"), "Repeats");
  assert.equal(describeRule(""), "Repeats");
});

test("ordinal endings", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "31st"]);
});

test("sameRule ignores the order of parts and the week start", () => {
  assert.equal(sameRule("FREQ=WEEKLY;BYDAY=TU", "BYDAY=TU;WKST=MO;FREQ=WEEKLY"), true);
  assert.equal(sameRule("FREQ=WEEKLY;BYDAY=TU", "FREQ=WEEKLY;BYDAY=WE"), false);
});

test("sameRepeat matches a rule that leaves its day to the start", () => {
  assert.equal(sameRepeat("FREQ=WEEKLY", "FREQ=WEEKLY;BYDAY=TU", TUESDAY), true);
  assert.equal(sameRepeat("FREQ=WEEKLY", "FREQ=WEEKLY;BYDAY=WE", TUESDAY), false);
  assert.equal(sameRepeat("FREQ=MONTHLY", "FREQ=MONTHLY;BYMONTHDAY=3", TUESDAY), true);
  assert.equal(sameRepeat("", "", TUESDAY), true);
  assert.equal(sameRepeat("FREQ=DAILY", "", TUESDAY), false);
  assert.equal(sameRepeat("FREQ=MONTHLY;BYSETPOS=1", "FREQ=MONTHLY;BYSETPOS=2", TUESDAY), false);
});

test("repeatChoices are worded for the event's own date, and every rule describes itself the same way", () => {
  const choices = repeatChoices(TUESDAY);
  assert.deepEqual(choices.map((c) => c.label), ["Does Not Repeat", "Every Day", "Every Weekday", "Every Week on Tuesday", "Every Month on the 3rd", "Every Year on 3 November"]);
  for (const c of choices.slice(1)) assert.equal(describeRule(c.value), c.label);
});
