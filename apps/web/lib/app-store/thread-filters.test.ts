// Tests for which view a conversation belongs to, in particular that Archive holds archived mail whatever it is.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Thread } from "../types";
import { inView, isWaiting } from "./thread-filters";

const thread = (over: Partial<Thread>) => ({ junk: false, subscription: false, status: "inbox", ...over }) as Thread;

test("archive view accepts junk and subscriptions as well as plain mail", () => {
  for (const t of [thread({}), thread({ junk: true }), thread({ junk: true, subscription: true })]) assert.equal(inView(t, "archive"), true);
});

test("the other views are unchanged", () => {
  assert.equal(inView(thread({ junk: true }), "junk"), true);
  assert.equal(inView(thread({ junk: true, subscription: true }), "subscriptions"), true);
  assert.equal(inView(thread({ junk: true }), "all"), false);
});

test("Waiting needs you to have written last, an expected answer, and two quiet days", () => {
  const now = Date.parse("2026-11-18T12:00:00Z");
  const waiting = thread({ lastFromMe: true, waiting: true, lastMessageAt: "2026-11-16T11:00:00Z" });
  assert.equal(isWaiting(waiting, now), true);
  assert.equal(isWaiting({ ...waiting, lastMessageAt: "2026-11-17T11:00:00Z" }, now), false); // only one day
  assert.equal(isWaiting({ ...waiting, waiting: false }, now), false);
  assert.equal(isWaiting({ ...waiting, lastFromMe: false }, now), false);
});
