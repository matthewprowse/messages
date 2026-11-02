// Tests for triage-why.ts: the words shown for a reason, and which "Not Right?" choices a conversation offers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { SUSPICIOUS_COPY, notRightOptions, whyText } from "./triage-why";

const base = { priority: "normal", needsReply: false, lastFromMe: false, junk: false, status: "inbox" } as const;

test("the AI's own words win, then the code's fixed words, then nothing", () => {
  assert.equal(whyText("asked_you", "You asked a question"), "You asked a question");
  assert.equal(whyText("newsletter", ""), "Newsletter");
  assert.equal(whyText("not_a_code", null), null);
  assert.equal(whyText(null, null), null);
});

test("long or spaced words are tidied and cut", () => {
  assert.equal(whyText("other", "  a   b  "), "a b");
  assert.equal(whyText("other", "x".repeat(200))?.length, 80);
});

test("an urgent conversation can be said to be not important, and one needing a reply to need none", () => {
  assert.deepEqual(notRightOptions({ ...base, priority: "urgent", needsReply: true }).map((o) => o.value), ["not_important", "no_reply_needed"]);
  assert.deepEqual(notRightOptions({ ...base, needsReply: true }).map((o) => o.value), ["no_reply_needed"]);
});

test("a junk conversation offers Not Junk only, and a quiet one offers nothing", () => {
  assert.deepEqual(notRightOptions({ ...base, junk: true, priority: "low" }).map((o) => o.value), ["not_junk"]);
  assert.deepEqual(notRightOptions(base), []);
});

test("every fraud kind the AI can flag has a warning", () => {
  for (const kind of ["payment_change", "phishing", "impersonation"]) assert.ok(SUSPICIOUS_COPY[kind].title);
});
