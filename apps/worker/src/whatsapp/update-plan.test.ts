// update-plan.ts: which message updates are a deletion or an edit, and the time an edit carries so a redelivery is recognised.

import assert from "node:assert/strict";
import { test } from "node:test";
import { WAMessageStubType } from "baileys";
import { contentChange } from "./update-plan";

test("a revoke is a deletion", () => {
  assert.deepEqual(contentChange({ messageStubType: WAMessageStubType.REVOKE }, 5), { kind: "delete" });
});

test("an edit carries its new text and its own time", () => {
  const change = contentChange({ message: { editedMessage: { message: { protocolMessage: { timestampMs: 1_700_000_000_000, editedMessage: { conversation: "Fixed text" } } } } } }, 5);
  assert.deepEqual(change, { kind: "edit", text: "Fixed text", preview: "Fixed text", editTs: 1_700_000_000_000 });
});

test("an edit without a time uses the time it was seen", () => {
  const change = contentChange({ message: { editedMessage: { message: { conversation: "New" } } } }, 99);
  assert.equal(change?.kind === "edit" && change.editTs, 99);
});

test("a receipt or an unreadable edit is no content change", () => {
  assert.equal(contentChange({}, 1), null);
  assert.equal(contentChange({ message: { editedMessage: { message: { senderKeyDistributionMessage: {} } } } }, 1), null);
});
