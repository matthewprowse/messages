// Tests for caldav/ical.ts. Pin down time and duration parsing, how an iCloud event is stored like a Google one
// (organizer, occurrence ids, all-day, cancelled), line unfolding and meeting link detection.

import assert from "node:assert/strict";
import { test } from "node:test";
import { icsDuration, icsTimestamp, meetingLink, parseEvents, storedIcsEvent } from "./ical";

const owner = { userId: "u1", accountId: "a1", calendarId: "cal1", selfAddresses: new Set(["me@firm.co.za"]) };
const wrap = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;

test("reads UTC, zoned, floating and date-only times", () => {
  const at = (line: string) => icsTimestamp(parseEvents(wrap(`BEGIN:VEVENT\r\nUID:x\r\n${line}\r\nEND:VEVENT`))[0].start);
  assert.deepEqual(at("DTSTART:20261024T080000Z"), { at: "2026-10-24T08:00:00.000Z", allDay: false });
  // Johannesburg is UTC+2 all year; New York is UTC-4 until 1 Nov, then UTC-5.
  assert.deepEqual(at("DTSTART;TZID=Africa/Johannesburg:20261024T100000"), { at: "2026-10-24T08:00:00.000Z", allDay: false });
  assert.deepEqual(at("DTSTART;TZID=America/New_York:20261024T100000"), { at: "2026-10-24T14:00:00.000Z", allDay: false });
  assert.deepEqual(at("DTSTART;TZID=America/New_York:20261201T100000"), { at: "2026-12-01T15:00:00.000Z", allDay: false });
  assert.deepEqual(at("DTSTART:20261024T100000"), { at: "2026-10-24T10:00:00.000Z", allDay: false });
  assert.deepEqual(at("DTSTART;VALUE=DATE:20261224"), { at: "2026-12-24T00:00:00Z", allDay: true });
  assert.equal(at("DTSTART:garbage"), null);
});

test("reads durations", () => {
  assert.equal(icsDuration("PT1H30M"), 90 * 60_000);
  assert.equal(icsDuration("P1D"), 86_400_000);
  assert.equal(icsDuration("P1W"), 7 * 86_400_000);
  assert.equal(icsDuration("PT30S"), 30_000);
  assert.equal(icsDuration("nonsense"), null);
  assert.equal(icsDuration("P"), null);
  assert.equal(icsDuration(null), null);
});

test("stores an iCloud event like a Google one", () => {
  const [event] = parseEvents(
    wrap(
      [
        "BEGIN:VEVENT",
        "UID:ABC-1",
        "SUMMARY:Viewing at 12 Oak Lane\\, Sea Point",
        "DTSTART;TZID=Africa/Johannesburg:20261024T100000",
        "DTEND;TZID=Africa/Johannesburg:20261024T110000",
        "LOCATION:12 Oak Lane\\nSea Point",
        'ORGANIZER;CN="Naidoo, Priya":mailto:Priya@Client.com',
        'ATTENDEE;CN="Naidoo, Priya";PARTSTAT=ACCEPTED:mailto:priya@client.com',
        "ATTENDEE;CN=Me;PARTSTAT=ACCEPTED:mailto:me@firm.co.za",
        "ATTENDEE;PARTSTAT=TENTATIVE:mailto:sam@client.com",
        "ATTENDEE;CUTYPE=ROOM;PARTSTAT=ACCEPTED:mailto:room1@firm.co.za",
        "ATTENDEE;PARTSTAT=NEEDS-ACTION:urn:uuid:1234",
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "SUMMARY:Reminder",
        "END:VALARM",
        "END:VEVENT",
      ].join("\r\n"),
    ),
  );
  const row = storedIcsEvent(event, owner);
  assert.ok(row);
  assert.equal(row.provider_event_id, "ABC-1");
  assert.equal(row.title, "Viewing at 12 Oak Lane, Sea Point"); // the alarm's SUMMARY is not the title
  assert.equal(row.starts_at, "2026-10-24T08:00:00.000Z");
  assert.equal(row.ends_at, "2026-10-24T09:00:00.000Z");
  assert.equal(row.all_day, false);
  assert.equal(row.location, "12 Oak Lane, Sea Point");
  assert.deepEqual(row.attendees, [
    { email: "priya@client.com", name: "Naidoo, Priya", response: "accepted", self: false, organizer: true },
    { email: "me@firm.co.za", name: "Me", response: "accepted", self: true, organizer: false },
    { email: "sam@client.com", name: null, response: "tentative", self: false, organizer: false },
  ]);
});

test("adds an organizer who is not listed, and gives each occurrence its own id", () => {
  const events = parseEvents(
    wrap(
      [
        "BEGIN:VEVENT",
        "UID:WEEKLY",
        "RECURRENCE-ID:20261024T080000Z",
        "DTSTART:20261024T080000Z",
        "DURATION:PT45M",
        "ORGANIZER;CN=Sam:mailto:sam@client.com",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:WEEKLY",
        "RECURRENCE-ID:20261031T080000Z",
        "DTSTART:20261031T080000Z",
        "DTEND:20261031T083000Z",
        "END:VEVENT",
      ].join("\r\n"),
    ),
  );
  const rows = events.map((e) => storedIcsEvent(e, owner));
  assert.deepEqual(rows.map((r) => r?.provider_event_id), ["WEEKLY#20261024T080000Z", "WEEKLY#20261031T080000Z"]);
  assert.equal(rows[0]?.ends_at, "2026-10-24T08:45:00.000Z");
  assert.deepEqual(rows[0]?.attendees, [{ email: "sam@client.com", name: "Sam", response: "accepted", self: false, organizer: true }]);
});

test("stores all-day events at midnight UTC and skips cancelled ones", () => {
  const [allDay, cancelled, noStart] = parseEvents(
    wrap(
      [
        "BEGIN:VEVENT\r\nUID:h1\r\nSUMMARY:Public holiday\r\nDTSTART;VALUE=DATE:20261216\r\nDTEND;VALUE=DATE:20261217\r\nEND:VEVENT",
        "BEGIN:VEVENT\r\nUID:c1\r\nSTATUS:CANCELLED\r\nDTSTART:20261024T080000Z\r\nEND:VEVENT",
        "BEGIN:VEVENT\r\nUID:n1\r\nSUMMARY:No start\r\nEND:VEVENT",
      ].join("\r\n"),
    ),
  );
  const row = storedIcsEvent(allDay, owner);
  assert.equal(row?.all_day, true);
  assert.equal(row?.starts_at, "2026-12-16T00:00:00Z");
  assert.equal(row?.ends_at, "2026-12-17T00:00:00Z");
  assert.equal(storedIcsEvent(cancelled, owner), null);
  assert.equal(storedIcsEvent(noStart, owner), null);
});

test("unfolds long lines", () => {
  const [event] = parseEvents(wrap("BEGIN:VEVENT\r\nUID:f1\r\nSUMMARY:A very long\r\n  title that was folded\r\nDTSTART:20261024T080000Z\r\nEND:VEVENT"));
  assert.equal(event.summary, "A very long title that was folded");
});

test("keeps the notes, calendar name, meeting link, file and series of an event", () => {
  const [one] = parseEvents(
    wrap(["BEGIN:VEVENT", "UID:U1", "SUMMARY:Call", "DTSTART:20261024T080000Z", "DESCRIPTION:Agenda\\nJoin: https://us02web.zoom.us/j/123456?pwd=abc.", "END:VEVENT"].join("\r\n")),
  );
  const row = storedIcsEvent(one, { ...owner, calendarName: "Work", resourceUrl: "https://p1-caldav.icloud.com/1/calendars/work/U1.ics" })!;
  assert.equal(row.description, "Agenda\nJoin: https://us02web.zoom.us/j/123456?pwd=abc.");
  assert.equal(row.calendar_name, "Work");
  assert.equal(row.conference_url, "https://us02web.zoom.us/j/123456?pwd=abc");
  assert.equal(row.resource_url, "https://p1-caldav.icloud.com/1/calendars/work/U1.ics");
  assert.equal(row.series_id, null);

  // Each occurrence of a repeating event names its series by the shared UID.
  const [occurrence] = parseEvents(wrap(["BEGIN:VEVENT", "UID:U2", "RECURRENCE-ID:20261031T080000Z", "SUMMARY:Standup", "DTSTART:20261031T080000Z", "END:VEVENT"].join("\r\n")));
  assert.equal(storedIcsEvent(occurrence, owner)!.series_id, "U2");
});

test("finds a meeting link, only over https", () => {
  const link = (over: Partial<Parameters<typeof meetingLink>[0]>) => meetingLink({ conference: null, url: null, description: null, location: null, ...over });
  assert.equal(link({ conference: "https://meet.google.com/abc-defg-hij" }), "https://meet.google.com/abc-defg-hij");
  assert.equal(link({ url: "https://teams.microsoft.com/l/meetup-join/xyz" }), "https://teams.microsoft.com/l/meetup-join/xyz");
  assert.equal(link({ location: "Online: https://acme.webex.com/meet/room, bring notes" }), "https://acme.webex.com/meet/room");
  assert.equal(link({ url: "https://example.com/event/1" }), null); // not a meeting service
  assert.equal(link({ url: "javascript:alert(1)", conference: "http://zoom.us/j/1" }), null);
  assert.equal(link({ description: "Lunch at noon" }), null);
});
