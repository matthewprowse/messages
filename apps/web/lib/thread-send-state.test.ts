// Tests for thread-send-state.ts: a reply the provider accepted says Sent, not Sending.

import { test } from "node:test";
import assert from "node:assert/strict";
import { sendStateLabel, sendStateOf, waitLabel } from "./thread-send-state";

test("each outbox status keeps its own state and label", () => {
  assert.equal(sendStateLabel(sendStateOf("queued")), "Waiting to Send");
  assert.equal(sendStateLabel(sendStateOf("sending")), "Sending");
  assert.equal(sendStateLabel(sendStateOf("sent")), "Sent");
  assert.equal(sendStateLabel(sendStateOf("failed")), "Not Sent");
});

test("a message held by a WhatsApp limit says which one", () => {
  assert.equal(waitLabel("daily_limit"), "Waiting: Daily WhatsApp Limit");
  assert.equal(waitLabel("new_chat_limit"), "Waiting: New Chat Limit");
});
