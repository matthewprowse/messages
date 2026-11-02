// Tests for which view a conversation belongs to, in particular that Archive holds archived mail whatever it is.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Thread } from "../types";
import { inView } from "./thread-filters";

const thread = (over: Partial<Thread>) => ({ junk: false, subscription: false, status: "inbox", ...over }) as Thread;

test("archive view accepts junk and subscriptions as well as plain mail", () => {
  for (const t of [thread({}), thread({ junk: true }), thread({ junk: true, subscription: true })]) assert.equal(inView(t, "archive"), true);
});

test("the other views are unchanged", () => {
  assert.equal(inView(thread({ junk: true }), "junk"), true);
  assert.equal(inView(thread({ junk: true, subscription: true }), "subscriptions"), true);
  assert.equal(inView(thread({ junk: true }), "all"), false);
});
