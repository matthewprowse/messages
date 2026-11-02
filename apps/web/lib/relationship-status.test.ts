// Tests for lib/relationship-status.ts: the wording of the status line for each state a contact can be in.

import test from "node:test";
import assert from "node:assert/strict";
import { agoText, statusLine, whenText } from "./relationship-status";

const now = new Date(2026, 10, 12, 15, 0); // Thursday 12 November 2026
const at = (month: number, day: number, hour = 9) => new Date(2026, month - 1, day, hour).toISOString();

test("no conversation gives no status", () => {
  assert.equal(statusLine(null, null, now), null);
  assert.equal(statusLine(undefined, undefined, now), null);
});

test("their message is the newest: waiting on you, by weekday inside a week and by date after", () => {
  assert.equal(statusLine(at(11, 10), at(11, 2), now), "Waiting on you since Tuesday");
  assert.equal(statusLine(at(11, 3), null, now), "Waiting on you since 3 Nov");
  assert.equal(statusLine(at(11, 11), null, now), "Waiting on you since yesterday");
  assert.equal(statusLine(at(11, 12, 8), null, now), "Waiting on you since today");
});

test("your message is the newest: waiting on them for a week, then when you last wrote", () => {
  assert.equal(statusLine(at(10, 1), at(11, 9), now), "Waiting on them since Monday");
  assert.equal(statusLine(null, at(11, 12, 8), now), "Waiting on them since today");
  assert.equal(statusLine(at(9, 1), at(10, 31), now), "You last wrote 12 days ago");
  assert.equal(statusLine(null, at(11, 5), now), "You last wrote 7 days ago");
});

test("a long silence is counted in months, and a week or more ago is a date", () => {
  assert.equal(agoText(at(7, 1), now), "4 months ago");
  assert.equal(agoText(at(11, 11), now), "yesterday");
  assert.equal(whenText(at(11, 5), now), "5 Nov");
});
