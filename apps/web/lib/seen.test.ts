// Tests for seen.ts: the one message that shows "Seen" on Instagram and LinkedIn.

import { test } from "node:test";
import assert from "node:assert/strict";
import { seenLabelId } from "./seen";

const mine = (id: string, receipt?: "sent" | "delivered" | "read") => ({ id, from: "me", receipt });
const theirs = (id: string) => ({ id, from: "c1" });

test("only the last seen message you sent gets the label", () => {
  const msgs = [mine("a", "read"), theirs("b"), mine("c", "read"), mine("d")];
  assert.equal(seenLabelId(msgs, "instagram"), "c");
  assert.equal(seenLabelId(msgs, "linkedin"), "c");
});

test("no label when nothing you sent is seen, or the last read one is not yours", () => {
  assert.equal(seenLabelId([mine("a"), theirs("b")], "instagram"), null);
  assert.equal(seenLabelId([], "instagram"), null);
});

test("WhatsApp and email never use it", () => {
  assert.equal(seenLabelId([mine("a", "read")], "whatsapp"), null);
  assert.equal(seenLabelId([mine("a", "read")], "email"), null);
});

test("a message still sending is skipped", () => {
  assert.equal(seenLabelId([mine("a", "read"), { ...mine("b", "read"), sendState: "sending" as const }], "instagram"), "a");
});
