// Tests for packages/analytics/src/index.ts and draft.ts: cleanProps lets only code words, small numbers and flags through, text is dropped,
// values fall into coarse buckets, and draftEdit describes an edit without its words.

import test from "node:test";
import assert from "node:assert/strict";
import { cleanProps, isWord, wordOf, sizeOf, minutesBucket } from "./index";
import { draftEdit } from "./draft";

test("only plain code words, small numbers and flags get through", () => {
  const out = cleanProps({
    screen: "inbox",
    ms: 420,
    phone: 27821234567,
    email: "a@b.com",
    Bad: 1,
    note: "Hello there",
    num: "27821234567",
    ok: true,
    kinds: ["accept", "Hello World", "other_time"],
  });
  assert.deepEqual(out, { screen: "inbox", ms: 420, ok: true, kinds: ["accept", "other_time"] });
});

test("text is dropped, never tidied into a word", () => {
  assert.equal(isWord("Alice Smith"), false);
  assert.equal(isWord("alice smith"), false);
  assert.equal(isWord("alice@example.com"), false);
  assert.equal(isWord("27821234567"), false);
  assert.equal(isWord("new_event"), true);
  assert.equal(wordOf("New Event"), "new_event");
  assert.equal(wordOf("Alice Smith's Notes!"), undefined);
  assert.equal(wordOf("contact-3f2a9c1e-77aa"), undefined); // an ID is not a name
});

test("screen widths and times fall into coarse buckets", () => {
  assert.equal(sizeOf(390), "phone");
  assert.equal(sizeOf(900), "tablet");
  assert.equal(sizeOf(1440), "desktop");
  assert.equal(minutesBucket(3), 5);
  assert.equal(minutesBucket(100000), 43200);
});

test("a draft sent as it was has no edit", () => {
  const e = draftEdit("Hi Sam,\n\nYes, Thursday works.\n\nThanks", "Hi Sam,\n\nYes, Thursday works.\n\nThanks");
  assert.equal(e.edited, false);
  assert.equal(e.changed_pct, 0);
  assert.equal(e.len_pct, 0);
});

test("an edit is described by what it did, not what it said", () => {
  const draft = "Dear Mr Jones,\n\nThank you for your message. I would be glad to meet on Thursday at three. Kindly confirm the venue.\n\nKind regards";
  const sent = "Hey Sam!\n\nThursday at 3 works, where are we meeting?\n\nCheers 🙂";
  const e = draftEdit(draft, sent);
  assert.equal(e.edited, true);
  assert.ok(e.len_pct < -40, `len_pct ${e.len_pct}`);
  assert.equal(e.greeting_changed, true);
  assert.equal(e.signoff_changed, true);
  assert.equal(e.q_added, true);
  assert.equal(e.emoji_added, true);
  assert.equal(e.tone_shift, "casual");
  assert.ok(e.changed_pct > 50);
  for (const v of Object.values(e)) assert.ok(typeof v === "boolean" || typeof v === "number" || v === "same" || v === "casual" || v === "formal");
});

test("a task tick is recorded as code words and flags, never its title", () => {
  const out = cleanProps({ action: "complete", provider: "google_tasks", overdue: true, timed: false, via: "calendar", title: "Send the offer to Sam" });
  assert.deepEqual(out, { action: "complete", provider: "google_tasks", overdue: true, timed: false, via: "calendar" });
});

test("dotted values (local parts, domains, file names) are dropped", () => {
  assert.equal(isWord("jane.doe"), false);
  assert.equal(isWord("acme.co"), false);
  assert.equal(wordOf("Jane.Doe"), undefined);
  assert.deepEqual(cleanProps({ detail: "jane.doe", where: "acme.co", list: ["ok_one", "sam.lee"] }), { list: ["ok_one"] });
  assert.equal(isWord("settings_accounts"), true);
});

test("a dot is allowed only between two digits, as in a model name or a version", () => {
  assert.equal(isWord("gemini-2.5-flash"), true);
  assert.equal(isWord("v0.0.12"), true);
  for (const bad of ["jane.doe", "acme.co", "a.b", "v1.", "v1.x", "x".repeat(41)]) assert.equal(isWord(bad), false, bad);
  assert.equal(wordOf("Jane.Doe"), undefined);
  assert.deepEqual(cleanProps({ model: "gemini-2.5-flash", where: "acme.co" }), { model: "gemini-2.5-flash" });
});
