// message-versions.ts: the original of an edited or deleted message is the earliest text kept.

import assert from "node:assert/strict";
import { test } from "node:test";
import { originalOf, type MessageVersion } from "./message-versions";

const v = (text: string, at: string, reason: MessageVersion["reason"] = "edited"): MessageVersion => ({ text, at, reason });

test("the original is the earliest kept text, however the list is ordered", () => {
  const list = [v("second", "2026-11-02T10:05:00Z"), v("first", "2026-11-02T10:00:00Z"), v("third", "2026-11-02T10:09:00Z", "deleted")];
  assert.equal(originalOf(list)?.text, "first");
});

test("nothing kept means no original", () => {
  assert.equal(originalOf([]), null);
});
