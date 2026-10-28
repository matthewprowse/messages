// Tests for calendar/create-event.ts (Google). Pin down the request built from a calendar_outbox row (time zones, all-day
// ranges, guests, Meet, recurrence), how a created event is stored, and which failures say it was not made.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BAD_ATTENDEES,
  BAD_TIME_ZONE,
  BAD_TIMES,
  EVENTS_NOT_GRANTED,
  MAYBE_CREATED,
  TOO_MANY_ATTENDEES,
  addDays,
  allDayRange,
  buildCreateEvent,
  cleanAttendees,
  createFailure,
  createdCalendarId,
  eventIdFor,
  localDate,
  storedEvent,
  type CalendarOutboxRow,
  type CreateEventRequest,
} from "./create-event";

function row(patch: Partial<CalendarOutboxRow> = {}): CalendarOutboxRow {
  return {
    id: "3f2b6c1e-0a4d-4e8b-9c7f-1d2e3f4a5b6c",
    recurrence: null,
    user_id: "u1",
    account_id: "a1",
    calendar_id: "primary",
    title: "Lunch with Julia",
    description: null,
    location: null,
    starts_at: "2026-11-03T10:00:00.000Z",
    ends_at: "2026-11-03T11:00:00.000Z",
    all_day: false,
    time_zone: "Africa/Johannesburg",
    attendees: [],
    send_invites: true,
    add_meet: false,
    status: "queued",
    error: null,
    provider_event_id: null,
    html_link: null,
    created_at: "2026-10-23T08:00:00.000Z",
    done_at: null,
    ...patch,
  };
}

function built(patch: Partial<CalendarOutboxRow> = {}): CreateEventRequest {
  const result = buildCreateEvent(row(patch));
  if ("error" in result) throw new Error(result.error);
  return result;
}

test("a timed event uses dateTime with the browser's time zone", () => {
  const request = built();
  assert.equal(request.url, "https://www.googleapis.com/calendar/v3/calendars/primary/events");
  assert.deepEqual(request.body.start, { dateTime: "2026-11-03T10:00:00.000Z", timeZone: "Africa/Johannesburg" });
  assert.deepEqual(request.body.end, { dateTime: "2026-11-03T11:00:00.000Z", timeZone: "Africa/Johannesburg" });
  assert.equal(request.body.summary, "Lunch with Julia");
  assert.equal("date" in request.body.start!, false);
});

test("a timed event keeps the instant whatever the time zone", () => {
  const request = built({ starts_at: "2026-11-03T12:00:00+02:00", ends_at: "2026-11-03T12:30:00+02:00", time_zone: "America/New_York" });
  assert.deepEqual(request.body.start, { dateTime: "2026-11-03T10:00:00.000Z", timeZone: "America/New_York" });
  assert.deepEqual(request.body.end, { dateTime: "2026-11-03T10:30:00.000Z", timeZone: "America/New_York" });
});

test("a one-day all-day event ends on the next day", () => {
  // Local midnight on 3 November to local midnight on 4 November in Johannesburg (UTC+2).
  const request = built({ all_day: true, starts_at: "2026-11-02T22:00:00Z", ends_at: "2026-11-03T22:00:00Z" });
  assert.deepEqual(request.body.start, { date: "2026-11-03" });
  assert.deepEqual(request.body.end, { date: "2026-11-04" });
  assert.equal("dateTime" in request.body.start!, false);
  assert.equal("timeZone" in request.body.start!, false);
});

test("an all-day end later in a day includes that day", () => {
  // 3 November 00:00 to 5 November 23:59 local covers three days.
  const range = allDayRange(new Date("2026-11-02T22:00:00Z"), new Date("2026-11-05T21:59:00Z"), "Africa/Johannesburg");
  assert.deepEqual(range, { start: "2026-11-03", end: "2026-11-06" });
});

test("all-day dates are read in the event's time zone, not UTC", () => {
  // 00:00 on 3 November in Auckland (UTC+13) is still 2 November in UTC.
  const range = allDayRange(new Date("2026-11-02T11:00:00Z"), new Date("2026-11-03T11:00:00Z"), "Pacific/Auckland");
  assert.deepEqual(range, { start: "2026-11-03", end: "2026-11-04" });
  // 00:00 on 3 November in Los Angeles (UTC-8) is 08:00 UTC.
  assert.deepEqual(allDayRange(new Date("2026-11-03T08:00:00Z"), new Date("2026-11-04T08:00:00Z"), "America/Los_Angeles"), {
    start: "2026-11-03",
    end: "2026-11-04",
  });
});

test("an all-day event across a clock change keeps whole days", () => {
  // Europe/London leaves summer time on 25 October 2026: midnight is 23:00 UTC before, 00:00 UTC after.
  const range = allDayRange(new Date("2026-10-23T23:00:00Z"), new Date("2026-10-27T00:00:00Z"), "Europe/London");
  assert.deepEqual(range, { start: "2026-10-24", end: "2026-10-27" });
});

test("an all-day event always covers at least one day", () => {
  const range = allDayRange(new Date("2026-11-02T22:00:00Z"), new Date("2026-11-02T22:00:01Z"), "Africa/Johannesburg");
  assert.deepEqual(range, { start: "2026-11-03", end: "2026-11-04" });
});

test("all-day end dates roll over months and years", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  const range = allDayRange(new Date("2026-12-31T00:00:00Z"), new Date("2027-01-01T00:00:00Z"), "UTC");
  assert.deepEqual(range, { start: "2026-12-31", end: "2027-01-01" });
});

test("local dates and midnight in a time zone", () => {
  assert.deepEqual(localDate(new Date("2026-11-02T22:00:00Z"), "Africa/Johannesburg"), { date: "2026-11-03", midnight: true });
  assert.deepEqual(localDate(new Date("2026-11-02T22:00:00.500Z"), "Africa/Johannesburg"), { date: "2026-11-03", midnight: false });
  assert.deepEqual(localDate(new Date("2026-11-03T05:30:00Z"), "Asia/Kolkata"), { date: "2026-11-03", midnight: false });
  assert.deepEqual(localDate(new Date("2026-11-02T18:30:00Z"), "Asia/Kolkata"), { date: "2026-11-03", midnight: true });
});

test("an unknown time zone fails before reaching Google", () => {
  assert.deepEqual(buildCreateEvent(row({ time_zone: "Mars/Olympus_Mons" })), { error: BAD_TIME_ZONE });
  assert.ok(!("error" in buildCreateEvent(row({ time_zone: "Etc/GMT+5" }))));
  assert.ok(!("error" in buildCreateEvent(row({ time_zone: "UTC" }))));
});

test("an event must end after it starts", () => {
  assert.deepEqual(buildCreateEvent(row({ ends_at: "2026-11-03T10:00:00.000Z" })), { error: BAD_TIMES });
  assert.deepEqual(buildCreateEvent(row({ ends_at: "2026-11-03T09:00:00.000Z" })), { error: BAD_TIMES });
  assert.deepEqual(buildCreateEvent(row({ starts_at: "not a date" })), { error: BAD_TIMES });
});

test("guests are trimmed, lowercased and deduped", () => {
  const request = built({ attendees: [" Julia@Example.com ", "julia@example.com", "", "bob@example.org"] });
  assert.deepEqual(request.body.attendees, [{ email: "julia@example.com" }, { email: "bob@example.org" }]);
});

test("an event without guests sends no attendees", () => {
  assert.equal(built().body.attendees, undefined);
  assert.equal(built({ attendees: [" "] }).body.attendees, undefined);
});

test("a bad guest or too many guests fails", () => {
  assert.deepEqual(buildCreateEvent(row({ attendees: ["julia@example.com", "not an email"] })), { error: BAD_ATTENDEES });
  assert.deepEqual(cleanAttendees(["<a@example.com>"]), { error: BAD_ATTENDEES });
  const fifty = Array.from({ length: 50 }, (_, i) => `guest${i}@example.com`);
  assert.equal((cleanAttendees(fifty) as string[]).length, 50);
  assert.deepEqual(cleanAttendees([...fifty, "one.more@example.com"]), { error: TOO_MANY_ATTENDEES });
  assert.equal((cleanAttendees([...fifty, "GUEST0@example.com"]) as string[]).length, 50);
});

test("invites go out only when asked", () => {
  assert.equal(built({ send_invites: true, attendees: ["julia@example.com"] }).query.sendUpdates, "all");
  assert.equal(built({ send_invites: false, attendees: ["julia@example.com"] }).query.sendUpdates, "none");
});

test("a Meet link is requested only when asked", () => {
  const without = built();
  assert.equal(without.query.conferenceDataVersion, undefined);
  assert.equal(without.body.conferenceData, undefined);

  const withMeet = built({ add_meet: true });
  assert.equal(withMeet.query.conferenceDataVersion, 1);
  assert.deepEqual(withMeet.body.conferenceData, {
    createRequest: { requestId: "3f2b6c1e-0a4d-4e8b-9c7f-1d2e3f4a5b6c", conferenceSolutionKey: { type: "hangoutsMeet" } },
  });
});

test("Meet works on an all-day event without invites", () => {
  const request = built({ add_meet: true, send_invites: false, all_day: true, starts_at: "2026-11-02T22:00:00Z", ends_at: "2026-11-03T22:00:00Z" });
  assert.deepEqual(request.query, { sendUpdates: "none", conferenceDataVersion: 1 });
  assert.deepEqual(request.body.start, { date: "2026-11-03" });
});

test("description and location are sent only when filled in", () => {
  const empty = built({ description: "  ", location: "" });
  assert.equal(empty.body.description, undefined);
  assert.equal(empty.body.location, undefined);
  const filled = built({ description: " Agenda ", location: " The Test Kitchen " });
  assert.equal(filled.body.description, "Agenda");
  assert.equal(filled.body.location, "The Test Kitchen");
});

test("the event id comes from the row id and is valid for Google", () => {
  const id = eventIdFor("3F2B6C1E-0A4D-4E8B-9C7F-1D2E3F4A5B6C");
  assert.equal(id, "3f2b6c1e0a4d4e8b9c7f1d2e3f4a5b6c");
  assert.match(id, /^[a-v0-9]{5,1024}$/);
  assert.equal(built().body.id, "3f2b6c1e0a4d4e8b9c7f1d2e3f4a5b6c");
});

test("the calendar id is escaped in the address", () => {
  assert.equal(built({ calendar_id: "team@group.calendar.google.com" }).url, "https://www.googleapis.com/calendar/v3/calendars/team%40group.calendar.google.com/events");
});

test("a created event is stored like a synced one", () => {
  const stored = storedEvent(
    {
      id: "abc123",
      summary: "Lunch with Julia",
      location: "Cafe",
      start: { dateTime: "2026-11-03T12:00:00+02:00", timeZone: "Africa/Johannesburg" },
      end: { dateTime: "2026-11-03T13:00:00+02:00", timeZone: "Africa/Johannesburg" },
      attendees: [
        { email: "Julia@Example.com", responseStatus: "needsAction" },
        { email: "me@example.com", self: true, organizer: true, responseStatus: "accepted" },
        { email: "room@resource.calendar.google.com", resource: true },
      ],
    },
    { userId: "u1", accountId: "a1", calendarId: "me@example.com", calendarName: "Work" },
  );
  assert.deepEqual(stored, {
    user_id: "u1",
    account_id: "a1",
    calendar_id: "me@example.com",
    calendar_name: "Work",
    description: null,
    conference_url: null,
    resource_url: null,
    series_id: null,
    recurrence: null,
    provider_event_id: "abc123",
    title: "Lunch with Julia",
    starts_at: "2026-11-03T10:00:00.000Z",
    ends_at: "2026-11-03T11:00:00.000Z",
    all_day: false,
    location: "Cafe",
    attendees: [
      { email: "julia@example.com", name: null, response: "needsAction", self: false, organizer: false },
      { email: "me@example.com", name: null, response: "accepted", self: true, organizer: true },
    ],
  });
});

test("a created all-day event is stored at midnight UTC", () => {
  const stored = storedEvent({ id: "e1", start: { date: "2026-11-03" }, end: { date: "2026-11-04" } }, { userId: "u1", accountId: "a1", calendarId: "c" });
  assert.equal(stored?.starts_at, "2026-11-03T00:00:00Z");
  assert.equal(stored?.ends_at, "2026-11-04T00:00:00Z");
  assert.equal(stored?.all_day, true);
  assert.equal(storedEvent({ id: "e2", status: "cancelled", start: { date: "2026-11-03" } }, { userId: "u1", accountId: "a1", calendarId: "c" }), null);
  assert.equal(storedEvent({ start: { date: "2026-11-03" } }, { userId: "u1", accountId: "a1", calendarId: "c" }), null);
});

test("the primary calendar is filed under its real id", () => {
  assert.equal(createdCalendarId({ calendar_id: "primary" }, { organizer: { email: "me@example.com", self: true } }), "me@example.com");
  assert.equal(createdCalendarId({ calendar_id: "primary" }, {}), "primary");
  assert.equal(createdCalendarId({ calendar_id: "team@group.calendar.google.com" }, { organizer: { email: "me@example.com", self: true } }), "team@group.calendar.google.com");
});

test("only a clear refusal says the event was not made", () => {
  assert.equal(createFailure(null, null), MAYBE_CREATED);
  assert.equal(createFailure(500, null), MAYBE_CREATED);
  assert.equal(createFailure(503, "backendError"), MAYBE_CREATED);
  assert.equal(createFailure(409, "duplicate"), MAYBE_CREATED);
  assert.equal(createFailure(403, "insufficientPermissions"), EVENTS_NOT_GRANTED);
  assert.equal(createFailure(403, "rateLimitExceeded"), "Google Calendar is busy. Try again in a minute.");
  assert.equal(createFailure(429, null), "Google Calendar is busy. Try again in a minute.");
  assert.equal(createFailure(404, "notFound"), "You cannot add events to this calendar.");
  assert.equal(createFailure(400, "invalid"), "Google Calendar did not accept this event.");
});

test("a Google event keeps its notes, Meet link and series", () => {
  const stored = storedEvent(
    {
      id: "abc123_20261103T100000Z",
      recurringEventId: "abc123",
      summary: "Standup",
      description: "  Weekly sync  ",
      hangoutLink: "https://meet.google.com/abc-defg-hij",
      start: { dateTime: "2026-11-03T12:00:00+02:00" },
      end: { dateTime: "2026-11-03T12:15:00+02:00" },
    },
    { userId: "u1", accountId: "a1", calendarId: "me@example.com" },
  )!;
  assert.equal(stored.description, "Weekly sync");
  assert.equal(stored.conference_url, "https://meet.google.com/abc-defg-hij");
  assert.equal(stored.series_id, "abc123");
  const video = storedEvent(
    { id: "x", summary: "Call", start: { dateTime: "2026-11-03T12:00:00+02:00" }, conferenceData: { entryPoints: [{ entryPointType: "phone", uri: "tel:+1" }, { entryPointType: "video", uri: "javascript:1" }] } },
    { userId: "u1", accountId: "a1", calendarId: "c" },
  )!;
  assert.equal(video.conference_url, null); // only https links are kept
});

test("a repeating event is created with its rule, and a series' own event is stored with it", () => {
  const request = buildCreateEvent(row({ recurrence: "FREQ=WEEKLY;BYDAY=TU" }));
  assert.ok(!("error" in request));
  assert.deepEqual(request.body.recurrence, ["RRULE:FREQ=WEEKLY;BYDAY=TU"]);
  assert.deepEqual(buildCreateEvent(row({ recurrence: "FREQ=WEEKLY\nATTENDEE:mailto:x@example.com" })), { error: "This repeat is not one the calendar knows." });
  const stored = storedEvent(
    { id: "series1", summary: "Standup", start: { dateTime: "2026-11-03T09:00:00+02:00" }, end: { dateTime: "2026-11-03T09:15:00+02:00" }, recurrence: ["EXDATE:20261110T070000Z", "RRULE:FREQ=WEEKLY;BYDAY=TU"] },
    { userId: "u1", accountId: "a1", calendarId: "primary" },
  );
  assert.equal(stored?.recurrence, "FREQ=WEEKLY;BYDAY=TU");
});
