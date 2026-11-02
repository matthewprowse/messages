// Tests for compose-dirty.ts: an untouched New Email closes freely, one with typing in it asks for a deliberate close.

import { test } from "node:test";
import assert from "node:assert/strict";
import { composeIsDirty } from "./compose-dirty";

const opened = { to: ["a@x.co"], subject: "Fwd: Quote", body: "quoted" };

test("as opened it is not dirty", () => {
  assert.equal(composeIsDirty({ to: "a@x.co", cc: "", bcc: "", subject: "Fwd: Quote", body: "quoted" }, opened), false);
  assert.equal(composeIsDirty({ to: "", cc: "", bcc: "", subject: "", body: "" }, { to: [], subject: "", body: "" }), false);
});

test("typing in any field makes it dirty", () => {
  assert.equal(composeIsDirty({ to: "a@x.co", cc: "", bcc: "", subject: "Fwd: Quote", body: "quoted and more" }, opened), true);
  assert.equal(composeIsDirty({ to: "b@x.co", cc: "", bcc: "", subject: "Fwd: Quote", body: "quoted" }, opened), true);
  assert.equal(composeIsDirty({ to: "a@x.co", cc: "c@x.co", bcc: "", subject: "Fwd: Quote", body: "quoted" }, opened), true);
});
