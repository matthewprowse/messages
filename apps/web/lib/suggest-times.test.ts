// Tests for suggest-times.ts: the text that goes in the box, built from freeSlots (the same free time code as guided drafting).

import { test } from "node:test";
import assert from "node:assert/strict";
import { freeSlots, slotLabel } from "./choices";
import { addBelow, suggestTimesText } from "./suggest-times";

const now = new Date(2026, 10, 2, 7, 0);

test("three free slots, one a line, skipping a busy hour", () => {
  const busy = [{ id: "e", title: "Call", startsAt: new Date(2026, 10, 2, 8).toISOString(), endsAt: new Date(2026, 10, 2, 9).toISOString(), allDay: false }];
  const slots = freeSlots(busy as never, now, now);
  assert.equal(slots.length, 3);
  const text = suggestTimesText(slots);
  assert.equal(text, `A few times that work for me:\n\n${slots.map(slotLabel).join("\n")}`);
  assert.ok(!text.includes(slotLabel(new Date(2026, 10, 2, 8))));
});

test("no slots gives no text", () => {
  assert.equal(suggestTimesText([]), "");
});

test("addBelow leaves what is there and starts fresh in an empty box", () => {
  assert.equal(addBelow("Hello\n", "Times"), "Hello\n\nTimes");
  assert.equal(addBelow("  ", "Times"), "Times");
});
