// Tests for thread-nav.ts: after archive or delete the next conversation opens side by side, the list on a phone.

import { test } from "node:test";
import assert from "node:assert/strict";
import { leaveHref } from "./thread-nav";

const order = ["a", "b", "c"];

test("side by side, the next conversation opens and the list's query is kept", () => {
  assert.equal(leaveHref(order, ["a"], "a", "/inbox", "view=priority", true), "/inbox/b?view=priority");
});

test("on a phone it goes back to the list", () => {
  assert.equal(leaveHref(order, ["a"], "a", "/inbox", "", false), "/inbox");
});

test("with nothing left it goes to the list, and the Summary page does not advance", () => {
  assert.equal(leaveHref(["a"], ["a"], "a", "/inbox", "", true), "/inbox");
  assert.equal(leaveHref(order, ["a"], "a", "/summary", "", true, false), "/summary");
});
