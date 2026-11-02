// Tests for send/outgoing-text.ts: an unreadable body or subject must stop the send, an empty one must not.

import assert from "node:assert/strict";
import { test } from "node:test";
import { openOutgoingText } from "./outgoing-text";

const ok = async (v: string | null) => (v ? v.replace(/^e1:/, "") : v);
const broken = async () => { throw new Error("no key"); };

test("opens an encrypted body and subject", async () => {
  const out = await openOutgoingText({ body: "e1:hi", subject: "e1:Hello" }, ok);
  assert.deepEqual(out, { body: "hi", subject: "Hello" });
});

test("a legitimately empty body is allowed", async () => {
  assert.deepEqual(await openOutgoingText({ body: "", subject: null }, ok), { body: "", subject: null });
  assert.deepEqual(await openOutgoingText({ body: null, subject: "s" }, ok), { body: "", subject: "s" });
});

test("a body that cannot be opened returns null instead of an empty text", async () => {
  assert.equal(await openOutgoingText({ body: "e1:x", subject: "s" }, broken), null);
});

test("a subject that cannot be opened returns null", async () => {
  assert.equal(await openOutgoingText({ body: "ok", subject: "e1:x" }, ok, broken), null);
});
