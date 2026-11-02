// Tests for whatsapp/send-reason.ts: failure wording and the status to receipt mapping.

import { test } from "node:test";
import assert from "node:assert/strict";
import { receiptOf, sendFailureReason } from "./send-reason";

test("a partly sent reply says how many parts went", () => {
  assert.equal(sendFailureReason(1, 3), "Only 1 of 3 parts were sent. Check WhatsApp before sending the rest.");
  assert.match(sendFailureReason(0, 3), /may not have been sent/);
});

test("statuses map to read, delivered, sent, or no receipt", () => {
  assert.equal(receiptOf(5), "read");
  assert.equal(receiptOf(4), "read");
  assert.equal(receiptOf(3), "delivered");
  assert.equal(receiptOf(2), "sent");
  assert.equal(receiptOf(1), null);
});
