// The words on a WhatsApp call line (call-line.tsx): which way the call went, how it ended and how long it lasted.

import { test } from "node:test";
import assert from "node:assert/strict";
import { callLabel, callLength } from "./call-line";

const voice = { video: false, missed: false };

test("a call to you that was missed or declined says so and nothing more", () => {
  assert.deepEqual(callLabel({ ...voice, missed: true }, false), { title: "Missed Voice Call" });
  assert.deepEqual(callLabel({ ...voice, video: true, declined: true }, false), { title: "Declined Video Call" });
});

test("an answered call says which way it went and how long it lasted", () => {
  assert.deepEqual(callLabel({ ...voice, seconds: 192 }, true), { title: "Outgoing Voice Call", detail: "3 Min" });
  assert.deepEqual(callLabel({ ...voice, seconds: 45 }, false), { title: "Incoming Voice Call", detail: "45 Sec" });
  assert.deepEqual(callLabel(voice, false), { title: "Incoming Voice Call", detail: undefined });
});

test("a call you made that nobody answered reads No Answer, not Missed", () => {
  assert.deepEqual(callLabel({ ...voice, missed: true }, true), { title: "Outgoing Voice Call", detail: "No Answer" });
});

test("lengths round the way WhatsApp says them", () => {
  assert.equal(callLength(59), "59 Sec");
  assert.equal(callLength(90), "2 Min");
  assert.equal(callLength(3900), "1 Hr 5 Min");
});
