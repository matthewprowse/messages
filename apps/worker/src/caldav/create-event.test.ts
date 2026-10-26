import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalendarOutboxRow } from "../calendar/create-event";
import { createFailure, buildIcs, MAYBE_CREATED, NO_ORGANIZER } from "./create-event";
import { parseEvents, storedIcsEvent } from "./ical";

const row = (patch: Partial<CalendarOutboxRow> = {}): CalendarOutboxRow => ({
  id: "0a1b2c3d-1111-2222-3333-444455556666",
  user_id: "u1",
  account_id: "a1",
  calendar_id: "primary",
  title: "Lunch, with Priya; bring the plan",
  description: null,
  location: null,
  starts_at: "2026-10-24T10:00:00.000Z",
  ends_at: "2026-10-24T11:30:00.000Z",
  all_day: false,
  time_zone: "Africa/Johannesburg",
  attendees: [],
  send_invites: true,
  add_meet: false,
  status: "queued",
  error: null,
  provider_event_id: null,
  html_link: null,
  created_at: "2026-10-24T08:00:00.000Z",
  done_at: null,
  ...patch,
});
const now = new Date("2026-10-24T08:00:00.000Z");
const unfold = (ics: string) => ics.replace(/\r\n /g, "").split("\r\n");
const ok = (r: ReturnType<typeof buildIcs>) => {
  assert.ok(!("error" in r), "error" in r ? r.error : "");
  return r;
};

test("builds a timed event in its own time zone with escaped text", () => {
  const { uid, ics } = ok(buildIcs(row({ location: "Cafe Roux\nSea Point", description: "Bring\\the plan" }), null, now));
  assert.equal(uid, "0a1b2c3d111122223333444455556666");
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!ics.replace(/\r\n/g, "").includes("\n"));
  for (const line of [`UID:${uid}`, "DTSTAMP:20261024T080000Z", "DTSTART;TZID=Africa/Johannesburg:20261024T120000", "DTEND;TZID=Africa/Johannesburg:20261024T133000", "SUMMARY:Lunch\\, with Priya\; bring the plan", "LOCATION:Cafe Roux\\nSea Point", "DESCRIPTION:Bring\\\\the plan"]) {
    assert.ok(ics.split("\r\n").includes(line), line);
  }
  assert.ok(!ics.includes("ORGANIZER"));
});

test("what is built is what the sync reads back", () => {
  const { ics } = ok(buildIcs(row({ attendees: ["Sam@Client.com"] }), "me@firm.co.za", now));
  const stored = storedIcsEvent(parseEvents(ics)[0], { userId: "u1", accountId: "a1", calendarId: "cal", selfAddresses: new Set(["me@firm.co.za"]) });
  assert.equal(stored?.provider_event_id, "0a1b2c3d111122223333444455556666");
  assert.equal(stored?.title, "Lunch, with Priya; bring the plan");
  assert.equal(stored?.starts_at, "2026-10-24T10:00:00.000Z");
  assert.equal(stored?.ends_at, "2026-10-24T11:30:00.000Z");
  assert.deepEqual(stored?.attendees, [
    { email: "me@firm.co.za", name: null, response: "accepted", self: true, organizer: true },
    { email: "sam@client.com", name: null, response: "needsAction", self: false, organizer: false },
  ]);
});

test("guests are invited by iCloud unless invites are off", () => {
  const lines = (send: boolean) => unfold(ok(buildIcs(row({ attendees: ["sam@client.com", "me@firm.co.za"], send_invites: send }), "me@firm.co.za", now)).ics);
  const on = lines(true);
  assert.ok(on.includes("ORGANIZER:mailto:me@firm.co.za"));
  assert.ok(on.includes("ATTENDEE;PARTSTAT=ACCEPTED:mailto:me@firm.co.za"));
  assert.ok(on.includes("ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:sam@client.com"));
  assert.equal(on.filter((l) => l.startsWith("ATTENDEE")).length, 2); // the organizer is not invited twice
  const off = lines(false);
  assert.ok(off.includes("ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;SCHEDULE-AGENT=CLIENT:mailto:sam@client.com"));
});

test("guests need an address to invite from", () => {
  assert.deepEqual(buildIcs(row({ attendees: ["sam@client.com"] }), null, now), { error: NO_ORGANIZER });
  assert.ok(!("error" in buildIcs(row(), null, now)));
});

test("all-day events are dates with the end excluded", () => {
  // Midnight to midnight in Johannesburg is 22:00 UTC the evening before.
  const { ics } = ok(buildIcs(row({ all_day: true, starts_at: "2026-12-15T22:00:00.000Z", ends_at: "2026-12-16T22:00:00.000Z" }), null, now));
  const lines = unfold(ics);
  assert.ok(lines.includes("DTSTART;VALUE=DATE:20261216"));
  assert.ok(lines.includes("DTEND;VALUE=DATE:20261217"));
  const stored = storedIcsEvent(parseEvents(ics)[0], { userId: "u", accountId: "a", calendarId: "c", selfAddresses: new Set() });
  assert.equal(stored?.all_day, true);
  assert.equal(stored?.starts_at, "2026-12-16T00:00:00Z");
});

test("long lines are folded at 75 bytes without splitting a character", () => {
  const title = "Café ".repeat(40).trim();
  const { ics } = ok(buildIcs(row({ title }), null, now));
  for (const line of ics.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, line);
  assert.equal(parseEvents(ics)[0].summary, title);
});

test("refuses what cannot be made", () => {
  assert.deepEqual(buildIcs(row({ time_zone: "Not/AZone" }), null, now), { error: "This time zone is not recognised." });
  assert.deepEqual(buildIcs(row({ ends_at: "2026-10-24T10:00:00.000Z" }), null, now), { error: "The event must end after it starts." });
  assert.deepEqual(buildIcs(row({ attendees: ["nope"] }), "me@firm.co.za", now), { error: "One of the guests is not a valid email address." });
});

test("a refusal says why; anything else may have been created", () => {
  assert.equal(createFailure(null), MAYBE_CREATED);
  assert.equal(createFailure(503), MAYBE_CREATED);
  assert.equal(createFailure(412), MAYBE_CREATED);
  assert.match(createFailure(401), /pnpm connect:icloud-calendar/);
  assert.match(createFailure(403), /cannot add events/);
  assert.match(createFailure(429), /busy/);
  assert.match(createFailure(400), /did not accept/);
});

test("keeps a timed event made in UTC as a UTC time", () => {
  const lines = unfold(ok(buildIcs(row({ time_zone: "UTC" }), null, now)).ics);
  assert.ok(lines.includes("DTSTART:20261024T100000Z"));
  assert.ok(lines.includes("DTEND:20261024T113000Z"));
});
