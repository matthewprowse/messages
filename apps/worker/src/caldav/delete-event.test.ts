// Tests for caldav/delete-event.ts. Pin down how one occurrence is excluded from a series (EXDATE, dropped override,
// line endings kept) and that a file without a series is refused.

import assert from "node:assert/strict";
import { test } from "node:test";
import { excludeOccurrence, exceptionLine } from "./delete-event";
import { parseEvents } from "./ical";

const wrap = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;

const SERIES = [
  "BEGIN:VEVENT",
  "UID:WEEKLY-1",
  "SUMMARY:Standup",
  "DTSTART;TZID=Africa/Johannesburg:20261026T090000",
  "RRULE:FREQ=WEEKLY",
  "BEGIN:VALARM",
  "TRIGGER:-PT10M",
  "ACTION:DISPLAY",
  "END:VALARM",
  "END:VEVENT",
].join("\r\n");

// The 2 November occurrence was moved to the afternoon; 9 November was moved a day later.
const MOVED = (id: string, start: string) =>
  ["BEGIN:VEVENT", "UID:WEEKLY-1", `RECURRENCE-ID:${id}`, "SUMMARY:Standup (moved)", `DTSTART:${start}`, "END:VEVENT"].join("\r\n");

test("an exception is the occurrence's own RECURRENCE-ID, or its start", () => {
  assert.equal(exceptionLine("20261102T070000Z", "2026-11-02T07:00:00.000Z", false).line, "EXDATE:20261102T070000Z");
  assert.equal(exceptionLine("20261224", "2026-12-24T00:00:00.000Z", true).line, "EXDATE;VALUE=DATE:20261224");
  assert.equal(exceptionLine(null, "2026-11-02T07:00:00.000Z", false).line, "EXDATE:20261102T070000Z");
  assert.equal(exceptionLine("20261102T090000", "2026-11-02T07:00:00.000Z", false).line, "EXDATE:20261102T070000Z"); // a zone-less id is not trusted
  assert.equal(exceptionLine(null, "2026-12-24T00:00:00.000Z", true).line, "EXDATE;VALUE=DATE:20261224");
});

test("takes one occurrence out of a series, ahead of its alarm", () => {
  const out = excludeOccurrence(wrap(SERIES), { recurrenceId: "20261102T070000Z", startsAt: "2026-11-02T07:00:00.000Z", allDay: false })!;
  const lines = out.split("\r\n");
  const exdate = lines.indexOf("EXDATE:20261102T070000Z");
  assert.ok(exdate > lines.indexOf("RRULE:FREQ=WEEKLY") && exdate < lines.indexOf("BEGIN:VALARM"));
  assert.equal(lines.filter((l) => l === "BEGIN:VEVENT").length, 1);
  assert.ok(out.endsWith("END:VCALENDAR\r\n"));
  assert.equal(parseEvents(out).length, 1);
});

test("drops the edited copy of the occurrence and keeps the others", () => {
  const ics = wrap([SERIES, MOVED("20261102T070000Z", "20261102T130000Z"), MOVED("20261109T070000Z", "20261110T070000Z")].join("\r\n"));
  const out = excludeOccurrence(ics, { recurrenceId: "20261102T070000Z", startsAt: "2026-11-02T13:00:00.000Z", allDay: false })!;
  const left = parseEvents(out);
  assert.equal(left.length, 2); // the series and the 9 November copy
  assert.deepEqual(left.map((e) => e.recurrenceId), [null, "20261109T070000Z"]);
  assert.ok(out.includes("EXDATE:20261102T070000Z"));
  assert.ok(!out.includes("20261102T130000Z"));
});

test("keeps the file's own line endings", () => {
  const out = excludeOccurrence(wrap(SERIES).replace(/\r\n/g, "\n"), { recurrenceId: null, startsAt: "2026-11-02T07:00:00.000Z", allDay: false })!;
  assert.ok(!out.includes("\r"));
});

test("a file with no series in it has nothing to take the occurrence out of", () => {
  assert.equal(excludeOccurrence(wrap(MOVED("20261102T070000Z", "20261102T130000Z")), { recurrenceId: "20261102T070000Z", startsAt: "2026-11-02T13:00:00.000Z", allDay: false }), null);
});
