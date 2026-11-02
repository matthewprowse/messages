// Tests for send-safety.ts: retry only for definite failures, Enter never submits from single-line fields, and the
// outbox id is kept across a retry so a lost response cannot create a second row.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createSendKeys, enterSubmitsByAccident, insertOnce, sendRecovery, sendSignature } from "./send-safety";

test("sendRecovery hides Retry when the message may have gone out", () => {
  assert.equal(sendRecovery("Sending was interrupted. Check your Sent folder before trying again.", 0), "unsure");
  assert.equal(sendRecovery("The email may have been sent. Check your Sent folder before sending again.", 0), "unsure");
  assert.equal(sendRecovery("The reply may have been sent. Check your Sent Items before sending again.", 2), "unsure");
});

test("sendRecovery offers Retry for a definite failure without files", () => {
  assert.equal(sendRecovery("Gmail refused the address, so nothing was sent.", 0), "retry");
  assert.equal(sendRecovery(undefined, 0), "retry");
  assert.equal(sendRecovery("Nothing was sent.", 1), "none");
});

test("Enter in a text input would submit; textarea, buttons and other keys would not", () => {
  assert.equal(enterSubmitsByAccident("Enter", "INPUT", "text"), true);
  assert.equal(enterSubmitsByAccident("Enter", "input", undefined), true);
  assert.equal(enterSubmitsByAccident("Enter", "TEXTAREA"), false);
  assert.equal(enterSubmitsByAccident("Enter", "BUTTON"), false);
  assert.equal(enterSubmitsByAccident("Enter", "INPUT", "submit"), false);
  assert.equal(enterSubmitsByAccident("a", "INPUT", "text"), false);
});

test("the same unsettled message keeps its id; a settled one starts fresh", () => {
  let n = 0;
  const keys = createSendKeys(() => `id${++n}`);
  const sig = sendSignature({ scope: "t1", body: "Hello" });
  assert.deepEqual(keys.begin(sig), { id: "id1", busy: false });
  keys.end(sig, false);
  assert.equal(keys.begin(sig).id, "id1");
  keys.end(sig, true);
  assert.equal(keys.begin(sig).id, "id2");
});

test("a second begin while the first is in flight is reported busy", () => {
  const keys = createSendKeys(() => "x");
  const sig = sendSignature({ scope: "t", body: "b" });
  keys.begin(sig);
  assert.equal(keys.begin(sig).busy, true);
});

test("different recipients or From make a different message", () => {
  const a = sendSignature({ scope: "t", body: "b", cc: ["a@x.com"] });
  assert.notEqual(a, sendSignature({ scope: "t", body: "b", cc: [] }));
  assert.notEqual(a, sendSignature({ scope: "t", body: "b", cc: ["a@x.com"], from: "me@x.com" }));
});

test("insertOnce treats a duplicate key as success and reads the row back", async () => {
  const r = await insertOnce(
    async () => ({ data: null, error: { code: "23505" } }),
    async () => ({ data: { id: "r1" }, error: null }),
  );
  assert.deepEqual(r, { data: { id: "r1" }, error: false });
});

test("insertOnce fails on other errors and on a duplicate that cannot be read", async () => {
  assert.equal((await insertOnce(async () => ({ data: null, error: { code: "42501" } }), async () => ({ data: { id: "r" }, error: null }))).error, true);
  assert.equal((await insertOnce(async () => ({ data: null, error: { code: "23505" } }), async () => ({ data: null, error: null }))).error, true);
  assert.equal((await insertOnce(async () => ({ data: { id: "ok" }, error: null }), async () => ({ data: null, error: null }))).data?.id, "ok");
});
