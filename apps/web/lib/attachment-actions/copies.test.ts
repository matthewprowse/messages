// Tests for copies.ts: other conversations are counted once each, the current one is left out, and the label reads right.

import { test } from "node:test";
import assert from "node:assert/strict";
import { alsoInLabel, copyHref, groupCopies } from "./copies";

const row = (thread_id: string, message_id: string) => ({ attachment_id: `a-${message_id}`, message_id, thread_id });

test("copies in the same conversation count once and the current conversation is left out", () => {
  const out = groupCopies([row("t1", "m1"), row("t2", "m2"), row("t2", "m3"), row("t3", "m4")], "t1");
  assert.deepEqual(out, [{ threadId: "t2", messageId: "m2" }, { threadId: "t3", messageId: "m4" }]);
});

test("no copies gives nothing to show", () => {
  assert.deepEqual(groupCopies([], "t1"), []);
});

test("the label and link read right", () => {
  assert.equal(alsoInLabel(1), "Also in 1 Conversation");
  assert.equal(alsoInLabel(3), "Also in 3 Conversations");
  assert.equal(copyHref({ threadId: "t", messageId: "m" }), "/inbox/t?message=m");
});
