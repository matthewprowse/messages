// Tests for schedule.ts: the title and guests a new event starts with when opened from a conversation.

import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanSubject, scheduleDefaults } from "./schedule";

const people = [
  { id: "p1", name: "Priya Naidoo", emails: ["Priya@Client.com", "priya@home.com"] },
  { id: "p2", name: "Sam Dlamini", emails: [] },
  { id: "p3", name: "Kim Lee", emails: ["kim@lee.co.za"] },
];

test("the subject is the title without its Re: and Fwd: prefixes", () => {
  assert.equal(cleanSubject("Re: RE: Fwd: Quote for Oak Lane"), "Quote for Oak Lane");
  assert.equal(cleanSubject("  Viewing   on Thursday "), "Viewing on Thursday");
  assert.equal(cleanSubject(undefined), "");
  assert.equal(cleanSubject("Reminder: rent"), "Reminder: rent"); // "Re" alone before a colon is a prefix, "Reminder" is not
});

test("the guests are each person's first email, lowercase, once, and people without one are left out", () => {
  const d = scheduleDefaults({ subject: "Re: Offer", participantIds: ["p1", "p2", "p3", "p1", "unknown"] }, people);
  assert.deepEqual(d.guests, ["priya@client.com", "kim@lee.co.za"]);
  assert.equal(d.title, "Offer");
});

test("a chat with no subject and one person is a meeting with them; with several or none the title is left empty", () => {
  assert.equal(scheduleDefaults({ participantIds: ["p1"] }, people).title, "Meeting with Priya Naidoo");
  assert.equal(scheduleDefaults({ participantIds: ["p1", "p3"] }, people).title, "");
  assert.equal(scheduleDefaults({ participantIds: [] }, people).title, "");
});
