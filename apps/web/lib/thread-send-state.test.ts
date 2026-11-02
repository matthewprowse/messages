// Tests for thread-send-state.ts: a reply the provider accepted says Sent, not Sending.

import { test } from "node:test";
import assert from "node:assert/strict";
import { sendStateLabel, sendStateOf } from "./thread-send-state";

test("each outbox status keeps its own state and label", () => {
  assert.equal(sendStateLabel(sendStateOf("queued")), "Waiting to Send");
  assert.equal(sendStateLabel(sendStateOf("sending")), "Sending");
  assert.equal(sendStateLabel(sendStateOf("sent")), "Sent");
  assert.equal(sendStateLabel(sendStateOf("failed")), "Not Sent");
});
