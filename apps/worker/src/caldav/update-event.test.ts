// Tests for caldav/update-event.ts. Pin down how an iCloud event file is rewritten for a change or an RSVP: UID and
// SEQUENCE, guests and invites, single occurrence versus whole series, and what is refused.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readChange, type CalendarUpdateRow, type Change } from "../calendar/update-event";
import { parseEvents } from "./ical";
import { escapeText, occurrenceOf, updateIcs, withParam } from "./update-event";

const NOW = new Date("2026-10-26T08:00:00Z");
const ME = new Set(["me@icloud.com"]);
const wrap = (...events: string[]) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join("\r\n")}\r\nEND:VCALENDAR\r\n`;
const lines = (ics: string) => ics.replace(/\r\n[ \t]/g, "").split("\r\n").filter(Boolean);

const change = (patch: Partial<Change> = {}): Change => ({ kind: "update", scope: "occurrence", sendInvites: true, ...patch });
const SINGLE = ["BEGIN:VEVENT", "UID:ONE", "DTSTAMP:20261001T000000Z", "SEQUENCE:2", "DTSTART:20261104T100000Z", "DTEND:20261104T110000Z", "SUMMARY:Lunch", "LOCATION:Cafe", "DESCRIPTION:Bring the plan", "END:VEVENT"].join("\r\n");
const occ = (extra: Partial<ReturnType<typeof occurrenceOf>> = {}) => ({ recurrenceId: null, startsAt: "2026-11-04T10:00:00.000Z", endsAt: "2026-11-04T11:00:00.000Z", allDay: false, ...extra });
const run = (ics: string, c: Change, o = occ(), organizer: string | null = "me@icloud.com") => updateIcs(ics, { change: c, occurrence: o, selfAddresses: ME, organizer, now: NOW });
const ok = (r: ReturnType<typeof updateIcs>) => {
  assert.ok("ics" in r, "error" in r ? r.error : "");
  return r.ics;
};

test("a change keeps the UID and raises the SEQUENCE", () => {
  const out = lines(ok(run(wrap(SINGLE), change({ title: "Late lunch" }))));
  assert.ok(out.includes("UID:ONE"));
  assert.ok(out.includes("SEQUENCE:3"));
  assert.ok(out.includes("SUMMARY:Late lunch"));
  assert.ok(out.includes("DTSTAMP:20261026T080000Z"));
  assert.ok(out.includes("LOCATION:Cafe")); // untouched
  assert.equal(out.filter((l) => l.startsWith("SEQUENCE")).length, 1);
});

test("a missing SEQUENCE starts at 1, and the file keeps CRLF and ends with one", () => {
  const ics = ok(run(wrap(SINGLE.replace("SEQUENCE:2\r\n", "")), change({ title: "x" })));
  assert.ok(lines(ics).includes("SEQUENCE:1"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(ics));
});

test("an empty location or notes clears it; text is escaped", () => {
  const out = lines(ok(run(wrap(SINGLE), change({ location: "", description: "Line one\nPlan A, B; C" }))));
  assert.ok(!out.some((l) => l.startsWith("LOCATION")));
  assert.ok(out.includes("DESCRIPTION:Line one\\nPlan A\\, B\\; C"));
  assert.equal(escapeText("a\\b"), "a\\\\b");
});

test("a changed location drops iCloud's structured copy of the old one", () => {
  const ics = wrap(SINGLE.replace("LOCATION:Cafe", "LOCATION:Cafe\r\nX-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-TITLE=Cafe:geo:1,2"));
  const out = lines(ok(run(ics, change({ location: "Office" }))));
  assert.ok(out.includes("LOCATION:Office"));
  assert.ok(!out.some((l) => l.startsWith("X-APPLE-STRUCTURED-LOCATION")));
});

test("a new time replaces DTSTART, DTEND and DURATION", () => {
  const ics = wrap(SINGLE.replace("DTEND:20261104T110000Z", "DURATION:PT1H"));
  const time = { startsAt: new Date("2026-11-04T12:00:00Z"), endsAt: new Date("2026-11-04T13:30:00Z"), allDay: false, timeZone: "UTC" };
  const out = lines(ok(run(ics, change({ time }))));
  assert.deepEqual(out.filter((l) => /^(DTSTART|DTEND|DURATION)/.test(l)), ["DTSTART:20261104T120000Z", "DTEND:20261104T133000Z"]);
  const [event] = parseEvents(out.join("\r\n"));
  assert.equal(event.start?.value, "20261104T120000Z");
});

test("an all-day time is written as dates with the end excluded", () => {
  const time = { startsAt: new Date("2026-11-04T00:00:00Z"), endsAt: new Date("2026-11-05T00:00:00Z"), allDay: true, timeZone: "UTC" };
  const out = lines(ok(run(wrap(SINGLE), change({ time }))));
  assert.ok(out.includes("DTSTART;VALUE=DATE:20261104"));
  assert.ok(out.includes("DTEND;VALUE=DATE:20261105"));
});

test("long lines are folded and read back whole", () => {
  const title = "A".repeat(200);
  const ics = ok(run(wrap(SINGLE), change({ title })));
  assert.ok(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75));
  assert.equal(parseEvents(ics)[0].summary, title);
});

const WITH_GUESTS = [
  "BEGIN:VEVENT", "UID:TWO", "SEQUENCE:0", "DTSTART:20261104T100000Z", "DTEND:20261104T110000Z", "SUMMARY:Review",
  "ORGANIZER;CN=Me:mailto:me@icloud.com",
  "ATTENDEE;PARTSTAT=ACCEPTED:mailto:me@icloud.com",
  "ATTENDEE;CUTYPE=INDIVIDUAL;PARTSTAT=ACCEPTED;RSVP=TRUE:mailto:ann@example.com",
  "ATTENDEE;CUTYPE=INDIVIDUAL;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:bob@example.com",
  "ATTENDEE;CUTYPE=ROOM:mailto:room@example.com",
  "END:VEVENT",
].join("\r\n");

test("the guest list is replaced: yours, the organizer's and rooms stay, answers are kept", () => {
  const out = lines(ok(run(wrap(WITH_GUESTS), change({ attendees: ["ann@example.com", "cy@example.com"] }))));
  const guests = out.filter((l) => l.startsWith("ATTENDEE"));
  assert.equal(guests.length, 4);
  assert.ok(guests.some((l) => l.includes("PARTSTAT=ACCEPTED;RSVP=TRUE:mailto:ann@example.com")));
  assert.ok(guests.some((l) => l.includes("PARTSTAT=NEEDS-ACTION") && l.endsWith("mailto:cy@example.com")));
  assert.ok(guests.some((l) => l.endsWith("mailto:me@icloud.com")));
  assert.ok(guests.some((l) => l.endsWith("mailto:room@example.com")));
  assert.ok(!guests.some((l) => l.includes("bob@")));
  assert.ok(out.includes("ORGANIZER;CN=Me:mailto:me@icloud.com"));
});

test("without send_invites, guests are marked so iCloud does not email them; with it the mark goes", () => {
  const quiet = lines(ok(run(wrap(WITH_GUESTS), change({ attendees: ["ann@example.com", "cy@example.com"], sendInvites: false }))));
  const marked = quiet.filter((l) => l.includes("SCHEDULE-AGENT=CLIENT"));
  assert.equal(marked.length, 2);
  assert.ok(!quiet.find((l) => l.endsWith("mailto:me@icloud.com"))!.includes("SCHEDULE-AGENT"));
  const loud = lines(ok(run(wrap(quiet.join("\r\n")), change({ title: "Again" }))));
  assert.ok(!loud.some((l) => l.includes("SCHEDULE-AGENT")));
});

test("guests added to an event with none make you its organizer", () => {
  const out = lines(ok(run(wrap(SINGLE), change({ attendees: ["ann@example.com"] }))));
  assert.ok(out.includes("ORGANIZER:mailto:me@icloud.com"));
  assert.ok(out.includes("ATTENDEE;PARTSTAT=ACCEPTED:mailto:me@icloud.com"));
  assert.ok(out.some((l) => l.endsWith("mailto:ann@example.com") && l.includes("NEEDS-ACTION")));
  const none = run(wrap(SINGLE), change({ attendees: ["ann@example.com"] }), occ(), null);
  assert.ok("error" in none);
});

test("removing every guest leaves a plain event", () => {
  const out = lines(ok(run(wrap(WITH_GUESTS.replace("ATTENDEE;CUTYPE=ROOM:mailto:room@example.com\r\n", "")), change({ attendees: [] }))));
  assert.ok(!out.some((l) => l.startsWith("ATTENDEE") || l.startsWith("ORGANIZER")));
});

test("only the organizer can change an event's details", () => {
  const theirs = WITH_GUESTS.replace("ORGANIZER;CN=Me:mailto:me@icloud.com", "ORGANIZER:mailto:boss@example.com").replace("mailto:me@icloud.com", "mailto:me@icloud.com");
  const r = run(wrap(theirs), change({ title: "Mine now" }));
  assert.ok("error" in r);
});

test("an answer changes only your PARTSTAT, and leaves the SEQUENCE alone", () => {
  const theirs = WITH_GUESTS.replace("ORGANIZER;CN=Me:mailto:me@icloud.com", "ORGANIZER:mailto:boss@example.com").replace("ATTENDEE;PARTSTAT=ACCEPTED:mailto:me@icloud.com", "ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:me@icloud.com");
  const out = lines(ok(run(wrap(theirs), { kind: "rsvp", scope: "occurrence", sendInvites: true, response: "tentative" })));
  assert.ok(out.includes("ATTENDEE;PARTSTAT=TENTATIVE;RSVP=TRUE:mailto:me@icloud.com"));
  assert.ok(out.includes("SEQUENCE:0"));
  assert.ok(out.includes("ATTENDEE;CUTYPE=INDIVIDUAL;PARTSTAT=ACCEPTED;RSVP=TRUE:mailto:ann@example.com"));
  for (const [response, word] of [["accepted", "ACCEPTED"], ["declined", "DECLINED"]] as const) {
    const again = lines(ok(run(wrap(theirs), { kind: "rsvp", scope: "occurrence", sendInvites: true, response })));
    assert.ok(again.some((l) => l.includes(`PARTSTAT=${word}`) && l.endsWith("mailto:me@icloud.com")));
  }
});

test("an answer from someone who is not a guest is refused", () => {
  const r = run(wrap(SINGLE), { kind: "rsvp", scope: "occurrence", sendInvites: true, response: "accepted" });
  assert.ok("error" in r);
});

test("withParam sets, replaces and removes a parameter", () => {
  assert.equal(withParam("ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:a@b.c", "PARTSTAT", "ACCEPTED"), "ATTENDEE;PARTSTAT=ACCEPTED:mailto:a@b.c");
  assert.equal(withParam("ATTENDEE:mailto:a@b.c", "SCHEDULE-AGENT", "CLIENT"), "ATTENDEE;SCHEDULE-AGENT=CLIENT:mailto:a@b.c");
  assert.equal(withParam('ATTENDEE;CN="A: B";SCHEDULE-AGENT=CLIENT:mailto:a@b.c', "SCHEDULE-AGENT", null), 'ATTENDEE;CN="A: B":mailto:a@b.c');
});

// A weekly series in a zone with a clock change.
const SERIES = [
  "BEGIN:VEVENT", "UID:WEEKLY", "SEQUENCE:1", "DTSTART;TZID=Africa/Johannesburg:20261026T090000", "DTEND;TZID=Africa/Johannesburg:20261026T100000",
  "RRULE:FREQ=WEEKLY", "SUMMARY:Standup", "ORGANIZER:mailto:me@icloud.com", "ATTENDEE;PARTSTAT=ACCEPTED:mailto:me@icloud.com", "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:ann@example.com",
  "BEGIN:VALARM", "TRIGGER:-PT10M", "ACTION:DISPLAY", "END:VALARM",
  "END:VEVENT",
].join("\r\n");
const second = occ({ recurrenceId: "20261102T070000Z", startsAt: "2026-11-02T07:00:00.000Z", endsAt: "2026-11-02T08:00:00.000Z" });

test("one occurrence becomes an override with its own RECURRENCE-ID, and the series stays whole", () => {
  const ics = ok(run(wrap(SERIES), change({ title: "Standup (long)" }), second));
  const events = parseEvents(ics);
  assert.equal(events.length, 2);
  const master = events.find((e) => !e.recurrenceId)!;
  const override = events.find((e) => e.recurrenceId)!;
  assert.equal(master.summary, "Standup");
  assert.equal(override.uid, "WEEKLY");
  assert.equal(override.summary, "Standup (long)");
  assert.equal(override.attendees.length, 2);
  const text = lines(ics);
  assert.ok(text.includes("RECURRENCE-ID;TZID=Africa/Johannesburg:20261102T090000"));
  assert.ok(text.includes("DTSTART:20261102T070000Z"));
  assert.ok(text.includes("DTEND:20261102T080000Z"));
  assert.equal(text.filter((l) => l.startsWith("RRULE")).length, 1); // only the series repeats
  assert.equal(text.filter((l) => l === "BEGIN:VALARM").length, 2); // the alarm is copied
  assert.ok(text.includes("SEQUENCE:2"));
});

test("an occurrence changed twice edits its existing override", () => {
  const once = ok(run(wrap(SERIES), change({ title: "One" }), second));
  const twice = ok(run(once, change({ location: "Room 4" }), second));
  const events = parseEvents(twice);
  assert.equal(events.length, 2);
  const override = events.find((e) => e.recurrenceId)!;
  assert.equal(override.summary, "One");
  assert.equal(override.location, "Room 4");
  assert.ok(lines(twice).includes("SEQUENCE:3"));
});

test("a moved occurrence keeps its original RECURRENCE-ID", () => {
  const time = { startsAt: new Date("2026-11-02T13:00:00Z"), endsAt: new Date("2026-11-02T14:00:00Z"), allDay: false, timeZone: "Africa/Johannesburg" };
  const text = lines(ok(run(wrap(SERIES), change({ time }), second)));
  assert.ok(text.includes("RECURRENCE-ID;TZID=Africa/Johannesburg:20261102T090000"));
  assert.ok(text.includes("DTSTART:20261102T130000Z"));
});

test("a whole-series time change moves the series' wall clock in its own zone", () => {
  // The 2 November occurrence (09:00 in Johannesburg) goes to 10:30 for 1.5 hours.
  const time = { startsAt: new Date("2026-11-02T08:30:00Z"), endsAt: new Date("2026-11-02T10:00:00Z"), allDay: false, timeZone: "Africa/Johannesburg" };
  const text = lines(ok(run(wrap(SERIES), change({ scope: "series", time }), second)));
  assert.ok(text.includes("DTSTART;TZID=Africa/Johannesburg:20261026T103000"));
  assert.ok(text.includes("DTEND;TZID=Africa/Johannesburg:20261026T120000"));
  assert.equal(text.filter((l) => l.startsWith("RRULE")).length, 1);
  assert.equal(parseEvents(text.join("\r\n")).length, 1);
});

test("a whole-series change to details edits the series and not an override", () => {
  const withOverride = ok(run(wrap(SERIES), change({ title: "Special" }), second));
  const out = parseEvents(ok(run(withOverride, change({ scope: "series", title: "Daily Standup" }), second)));
  assert.equal(out.find((e) => !e.recurrenceId)!.summary, "Daily Standup");
  assert.equal(out.find((e) => e.recurrenceId)!.summary, "Special");
});

test("a whole-series all-day move shifts the dates", () => {
  const ALLDAY = SERIES.replace("DTSTART;TZID=Africa/Johannesburg:20261026T090000", "DTSTART;VALUE=DATE:20261026").replace("DTEND;TZID=Africa/Johannesburg:20261026T100000", "DTEND;VALUE=DATE:20261027");
  const day2 = occ({ recurrenceId: "20261102", startsAt: "2026-11-02T00:00:00Z", endsAt: "2026-11-03T00:00:00Z", allDay: true });
  const time = { startsAt: new Date("2026-11-03T00:00:00Z"), endsAt: new Date("2026-11-04T00:00:00Z"), allDay: true, timeZone: "UTC" };
  const text = lines(ok(run(wrap(ALLDAY), change({ scope: "series", time }), day2)));
  assert.ok(text.includes("DTSTART;VALUE=DATE:20261027"));
  assert.ok(text.includes("DTEND;VALUE=DATE:20261028"));
});

test("switching a series between all day and timed is refused", () => {
  const time = { startsAt: new Date("2026-11-02T00:00:00Z"), endsAt: new Date("2026-11-03T00:00:00Z"), allDay: true, timeZone: "UTC" };
  assert.ok("error" in run(wrap(SERIES), change({ scope: "series", time }), second));
});

test("an answer to a series goes on the series and its overrides", () => {
  const theirs = SERIES.replace("ORGANIZER:mailto:me@icloud.com", "ORGANIZER:mailto:boss@example.com").replace("PARTSTAT=ACCEPTED:mailto:me@icloud.com", "PARTSTAT=NEEDS-ACTION:mailto:me@icloud.com");
  const withOverride = ok(run(wrap(theirs), { kind: "rsvp", scope: "occurrence", sendInvites: true, response: "declined" }, second));
  assert.ok(parseEvents(withOverride).find((e) => e.recurrenceId)!.attendees.some((a) => a.params.PARTSTAT === "DECLINED" && a.value === "mailto:me@icloud.com"));
  // The series still says needs-action: only that occurrence was declined.
  assert.ok(parseEvents(withOverride).find((e) => !e.recurrenceId)!.attendees.some((a) => a.params.PARTSTAT === "NEEDS-ACTION" && a.value === "mailto:me@icloud.com"));
  const all = parseEvents(ok(run(withOverride, { kind: "rsvp", scope: "series", sendInvites: true, response: "accepted" }, second)));
  for (const e of all) assert.ok(e.attendees.some((a) => a.params.PARTSTAT === "ACCEPTED" && a.value === "mailto:me@icloud.com"));
});

test("a file with no event is refused", () => {
  assert.ok("error" in run("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", change({ title: "x" })));
});

test("occurrenceOf reads the RECURRENCE-ID from the stored id", () => {
  const o = occurrenceOf({ provider_event_id: "WEEKLY#20261102T070000Z", starts_at: "2026-11-02T07:00:00.000Z", ends_at: null, all_day: false });
  assert.equal(o.recurrenceId, "20261102T070000Z");
  assert.equal(occurrenceOf({ provider_event_id: "ONE", starts_at: "x", ends_at: null, all_day: false }).recurrenceId, null);
});

function row(patch: Partial<CalendarUpdateRow> = {}): CalendarUpdateRow {
  return {
    id: "1", user_id: "u", account_id: "a", event_id: "e", kind: "update", scope: "occurrence", title: null, description: null, location: null,
    starts_at: null, ends_at: null, all_day: null, time_zone: null, attendees: null, send_invites: true, response: null, status: "queued", error: null,
    created_at: "2026-10-26T08:00:00Z", done_at: null, recurrence: null, ...patch,
  };
}

test("readChange trims text and keeps empty location and notes as clears", () => {
  const c = readChange(row({ title: "  Hi ", location: "  ", description: "" }));
  assert.ok(!("error" in c));
  if ("error" in c) return;
  assert.equal(c.title, "Hi");
  assert.equal(c.location, "");
  assert.equal(c.description, "");
  assert.equal(c.time, undefined);
});

test("a new rule replaces the series' own, makes a single event repeat, and is refused for one occurrence", () => {
  const series = lines(ok(run(wrap(SERIES), change({ scope: "series", recurrence: "FREQ=DAILY;COUNT=5" }), second)));
  assert.ok(series.includes("RRULE:FREQ=DAILY;COUNT=5"));
  assert.ok(!series.includes("RRULE:FREQ=WEEKLY"));
  assert.ok(series.includes("UID:WEEKLY"));
  const single = lines(ok(run(wrap(SINGLE), change({ recurrence: "FREQ=WEEKLY;BYDAY=WE" }))));
  assert.ok(single.includes("RRULE:FREQ=WEEKLY;BYDAY=WE"));
  assert.deepEqual(run(wrap(SERIES), change({ recurrence: "FREQ=DAILY" }), second), { error: "A change to how an event repeats is for all of its events." });
});
