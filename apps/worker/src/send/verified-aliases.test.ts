// Tests for send/verified-aliases.ts: the provider's own send list per account, kept in memory, lowercase and deduped.

import { test } from "node:test";
import assert from "node:assert/strict";
import { forgetSendable, rememberSendable, verifiedSendable } from "./verified-aliases";

test("an account's list is what the connector last remembered, cleaned", () => {
  assert.equal(verifiedSendable("acc-new"), null);
  rememberSendable("acc-new", [" Me@Gmail.com ", "me@gmail.com", "", "alias@gmail.com"]);
  assert.deepEqual(verifiedSendable("acc-new"), ["me@gmail.com", "alias@gmail.com"]);
  rememberSendable("acc-new", ["me@gmail.com"]);
  assert.deepEqual(verifiedSendable("acc-new"), ["me@gmail.com"]);
  forgetSendable("acc-new");
  assert.equal(verifiedSendable("acc-new"), null);
});
