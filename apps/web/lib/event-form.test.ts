// Tests for event-form.ts: the step between times and the Repeat list's options and value.

import { test } from "node:test";
import assert from "node:assert/strict";
import { timeChoices } from "./dates";
import { NO_REPEAT, repeatOptionsFor, repeatSelectValue, STEP, UNKNOWN_REPEAT } from "./event-form";

test("times run every quarter hour through the day", () => {
  const times = timeChoices("", STEP);
  assert.equal(times.length, 96);
  assert.equal(times[0], "00:00");
  assert.equal(times[1], "00:15");
  assert.equal(times[95], "23:45");
});

test("a time between the steps is kept in the list, in order", () => {
  const times = timeChoices("09:10", STEP);
  assert.equal(times.length, 97);
  assert.equal(times[times.indexOf("09:10") - 1], "09:00");
  assert.equal(times[times.indexOf("09:10") + 1], "09:15");
  assert.equal(timeChoices("09:15", STEP).length, 96);
});

test("no rule leaves the plain choices, and none is selected", () => {
  const options = repeatOptionsFor("2026-03-09", "", false);
  assert.ok(options.some((o) => o.value === NO_REPEAT));
  assert.ok(!options.some((o) => o.value === UNKNOWN_REPEAT));
  assert.equal(repeatSelectValue(options, "2026-03-09", "", false), NO_REPEAT);
});

test("a series whose rule is unknown offers a Repeats placeholder and selects it", () => {
  const options = repeatOptionsFor("2026-03-09", "", true);
  assert.deepEqual(options.at(-1), { value: UNKNOWN_REPEAT, label: "Repeats" });
  assert.equal(repeatSelectValue(options, "2026-03-09", "", true), UNKNOWN_REPEAT);
});

test("a rule that matches no choice is added as a custom one and selected", () => {
  const rule = "RRULE:FREQ=DAILY;INTERVAL=3";
  const options = repeatOptionsFor("2026-03-09", rule, true);
  const custom = options.find((o) => o.value === rule);
  assert.ok(custom);
  assert.match(custom.label, /^Custom/);
  assert.equal(repeatSelectValue(options, "2026-03-09", rule, true), rule);
});
