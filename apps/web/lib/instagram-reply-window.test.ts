// Tests for instagram-reply-window.ts: the 24 hour and 7 day (Human Agent) reply window the composer notice uses.

import assert from "node:assert/strict";
import { test } from "node:test";
import { HUMAN_AGENT_MS, STANDARD_MS, humanAgentOn, replyWindow, windowClosesAt } from "./instagram-reply-window";

const NOW = 1_800_000_000_000;

test("a reply is open for 24 hours, whatever Human Agent says", () => {
  for (const ha of [false, true]) assert.equal(replyWindow(NOW - STANDARD_MS + 1, NOW, ha), "open");
});

test("Human Agent extends it to 7 days only when granted", () => {
  assert.equal(replyWindow(NOW - STANDARD_MS, NOW, true), "human_agent");
  assert.equal(replyWindow(NOW - STANDARD_MS, NOW, false), "closed");
  assert.equal(replyWindow(NOW - HUMAN_AGENT_MS + 1, NOW, true), "human_agent");
  assert.equal(replyWindow(NOW - HUMAN_AGENT_MS, NOW, true), "closed");
});

test("nothing from them means closed", () => {
  assert.equal(replyWindow(0, NOW, true), "closed");
});

test("the window closes at 24 hours, or 7 days with Human Agent", () => {
  const last = NOW - 1000;
  assert.equal(windowClosesAt(last, NOW, false), last + STANDARD_MS);
  assert.equal(windowClosesAt(last, NOW, true), last + HUMAN_AGENT_MS);
  assert.equal(windowClosesAt(NOW - HUMAN_AGENT_MS - 1, NOW, true), 0);
});

test("the Human Agent switch reads 1, true, on and yes", () => {
  assert.equal(humanAgentOn("1"), true);
  assert.equal(humanAgentOn(" TRUE "), true);
  assert.equal(humanAgentOn("0"), false);
  assert.equal(humanAgentOn(""), false);
  assert.equal(humanAgentOn(undefined), false);
});
