// formats.ts: CSV, vCard, iCalendar, file names and the readable conversation text.

import assert from "node:assert/strict";
import { test } from "node:test";
import { conversationText, csvField, icsCalendar, safeName, toCsv, uniquePath, vcard, vcards } from "./formats";

test("a CSV field is quoted only when it needs to be", () => {
  assert.equal(csvField("plain"), "plain");
  assert.equal(csvField('say "hi", ok'), '"say ""hi"", ok"');
  assert.equal(csvField("two\nlines"), '"two\nlines"');
  assert.equal(csvField(null), "");
  assert.equal(csvField(7), "7");
});

test("a field a spreadsheet would run as a formula is defused", () => {
  assert.equal(csvField("=HYPERLINK(\"x\")"), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvField("+27 82 123 4567"), "'+27 82 123 4567");
});

test("a CSV has a header, CRLF rows and a byte order mark", () => {
  assert.equal(toCsv(["Name", "Email"], [["Ann", "a@x.co"]]), "﻿Name,Email\r\nAnn,a@x.co\r\n");
});

test("a vCard carries the name, company, role, emails and phones with special characters escaped", () => {
  const card = vcard({ name: "Ann; Smith", emails: ["a@x.co", "b@x.co"], phones: ["+27821234567"], company: "Smith, Co", role: "CEO" });
  assert.equal(card, ["BEGIN:VCARD", "VERSION:3.0", "FN:Ann\\; Smith", "ORG:Smith\\, Co", "TITLE:CEO", "EMAIL;TYPE=INTERNET:a@x.co", "EMAIL;TYPE=INTERNET:b@x.co", "TEL:+27821234567", "END:VCARD"].join("\r\n"));
});

test("several cards make one file and none make an empty one", () => {
  assert.equal((vcards([{ name: "A", emails: [], phones: [] }, { name: "B", emails: [], phones: [] }]).match(/BEGIN:VCARD/g) ?? []).length, 2);
  assert.equal(vcards([]), "");
});

test("a timed event and an all-day event are written the way iCalendar wants", () => {
  const ics = icsCalendar(
    [
      { id: "e1", title: "Call, with Ann", startsAt: "2026-11-20T08:30:00Z", endsAt: "2026-11-20T09:00:00Z", allDay: false, location: "Cape Town" },
      { id: "e2", title: "Holiday", startsAt: "2026-12-24T00:00:00Z", endsAt: "2026-12-27T00:00:00Z", allDay: true, recurrence: "FREQ=YEARLY" },
    ],
    new Date("2026-11-02T10:00:00Z"),
  );
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.includes("DTSTART:20261120T083000Z\r\n"));
  assert.ok(ics.includes("SUMMARY:Call\\, with Ann\r\n"));
  assert.ok(ics.includes("DTSTART;VALUE=DATE:20261224\r\n") && ics.includes("DTEND;VALUE=DATE:20261227\r\n"));
  assert.ok(ics.includes("RRULE:FREQ=YEARLY\r\n"));
  assert.ok(ics.includes("DTSTAMP:20261102T100000Z\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
});

test("a long iCalendar line is folded", () => {
  const ics = icsCalendar([{ id: "e", title: "x".repeat(200), startsAt: "2026-11-20T08:30:00Z", endsAt: null, allDay: false }]);
  assert.ok(ics.split("\r\n").every((l) => l.length <= 74));
});

test("file names lose what a file system rejects and never start with a dot", () => {
  assert.equal(safeName('a/b\\c:d*e?"f<g>h|i'), "a b c d e f g h i");
  assert.equal(safeName("..hidden"), "hidden");
  assert.equal(safeName("   "), "Untitled");
  assert.equal(safeName("x".repeat(200)).length, 80);
});

test("two chats with the same name get different paths, whatever the case", () => {
  const taken = new Set<string>();
  assert.equal(uniquePath(taken, "conversations", "Ann", ".txt"), "conversations/Ann.txt");
  assert.equal(uniquePath(taken, "conversations", "ann", ".txt"), "conversations/ann (2).txt");
  assert.equal(uniquePath(taken, "conversations", "Ann", ".txt"), "conversations/Ann (3).txt");
});

test("a conversation reads as dated lines with files noted", () => {
  const text = conversationText("Ann", "Email", [
    { sentAt: "2026-11-20T08:30:00Z", direction: "in", who: "Ann", text: "Hello", files: ["plan.pdf"] },
    { sentAt: "2026-11-20T08:45:00Z", direction: "out", who: "me", text: "Hi", files: [] },
  ]);
  assert.equal(text, "Ann\nEmail, 2 messages\n\n2026-11-20 08:30 UTC  Ann\nHello\n[File: plan.pdf]\n\n2026-11-20 08:45 UTC  You\nHi\n");
});
