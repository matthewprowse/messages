import assert from "node:assert/strict";
import { test } from "node:test";
import { graphTimestamp, storedOutlookEvent } from "./calendar-event";

const owner = { userId: "u1", accountId: "a1", calendarId: "cal1", selfAddresses: new Set(["me@firm.co.za"]) };

test("reads Graph's UTC times", () => {
  assert.equal(graphTimestamp({ dateTime: "2026-10-24T08:30:00.0000000", timeZone: "UTC" }, false), "2026-10-24T08:30:00.000Z");
  assert.equal(graphTimestamp({ dateTime: "2026-10-24T00:00:00.0000000", timeZone: "UTC" }, true), "2026-10-24T00:00:00Z");
  assert.equal(graphTimestamp({ dateTime: "not a time" }, false), null);
  assert.equal(graphTimestamp(undefined, false), null);
});

test("stores an Outlook event like a Google one", () => {
  const row = storedOutlookEvent(
    {
      id: "e1",
      subject: "Viewing at 12 Oak Lane",
      isAllDay: false,
      start: { dateTime: "2026-10-24T08:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-10-24T09:00:00.0000000", timeZone: "UTC" },
      location: { displayName: "12 Oak Lane" },
      organizer: { emailAddress: { name: "Priya Naidoo", address: "Priya@Client.com" } },
      attendees: [
        { type: "required", status: { response: "accepted" }, emailAddress: { name: "Me", address: "me@firm.co.za" } },
        { type: "optional", status: { response: "tentativelyAccepted" }, emailAddress: { name: "", address: "sam@client.com" } },
        { type: "resource", status: { response: "accepted" }, emailAddress: { name: "Room 1", address: "room1@firm.co.za" } },
      ],
    },
    owner,
  );
  assert.ok(row);
  assert.equal(row.provider_event_id, "e1");
  assert.equal(row.title, "Viewing at 12 Oak Lane");
  assert.equal(row.starts_at, "2026-10-24T08:00:00.000Z");
  assert.equal(row.ends_at, "2026-10-24T09:00:00.000Z");
  assert.equal(row.all_day, false);
  assert.equal(row.location, "12 Oak Lane");
  // The organizer is added first, rooms are left out, and answers use Google's words.
  assert.deepEqual(row.attendees, [
    { email: "priya@client.com", name: "Priya Naidoo", response: "accepted", self: false, organizer: true },
    { email: "me@firm.co.za", name: "Me", response: "accepted", self: true, organizer: false },
    { email: "sam@client.com", name: null, response: "tentative", self: false, organizer: false },
  ]);
});

test("stores all-day events at midnight UTC on their date", () => {
  const row = storedOutlookEvent(
    { id: "e2", subject: "Public holiday", isAllDay: true, start: { dateTime: "2026-12-16T00:00:00.0000000" }, end: { dateTime: "2026-12-17T00:00:00.0000000" } },
    owner,
  );
  assert.ok(row);
  assert.equal(row.all_day, true);
  assert.equal(row.starts_at, "2026-12-16T00:00:00Z");
  assert.equal(row.ends_at, "2026-12-17T00:00:00Z");
  assert.deepEqual(row.attendees, []);
});

test("leaves out cancelled events and ones without a start", () => {
  assert.equal(storedOutlookEvent({ id: "e3", isCancelled: true, start: { dateTime: "2026-10-24T08:00:00" } }, owner), null);
  assert.equal(storedOutlookEvent({ id: "e4" }, owner), null);
  assert.equal(storedOutlookEvent({ start: { dateTime: "2026-10-24T08:00:00" } }, owner), null);
});
