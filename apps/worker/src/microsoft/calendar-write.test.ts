// Tests for calendar-write.ts: the Graph request a queued event becomes, and what a refusal is called.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalendarOutboxRow } from "../calendar/create-event";
import { INVITES_ALWAYS_SENT, RECURRENCE_NOT_SUPPORTED, WRITE_NOT_GRANTED, buildGraphCreate, createUrl, graphCreateFailure, graphDeleteFailure, targetId } from "./calendar-write";

const row = (over: Partial<CalendarOutboxRow> = {}): CalendarOutboxRow => ({
  id: "11111111-2222-3333-4444-555555555555",
  account_id: "a1",
  user_id: "u1",
  calendar_id: "primary",
  title: "  Site visit ",
  description: " Bring the plans ",
  location: "Sandton",
  starts_at: "2026-11-05T12:00:00.000Z", // 14:00 in Johannesburg
  ends_at: "2026-11-05T13:00:00.000Z",
  all_day: false,
  time_zone: "Africa/Johannesburg",
  attendees: ["Sam@Example.com", "sam@example.com", "kim@example.com"],
  send_invites: true,
  add_meet: false,
  recurrence: null,
  status: "queued",
  error: null,
  provider_event_id: null,
  html_link: null,
  created_at: "2026-11-02T10:00:00Z",
  done_at: null,
  ...over,
} as CalendarOutboxRow);

test("a timed event is posted to the default calendar in the wall clock of its zone", () => {
  const request = buildGraphCreate(row());
  assert.ok(!("error" in request));
  assert.equal(request.url, "/me/calendar/events");
  assert.deepEqual(request.body.start, { dateTime: "2026-11-05T14:00:00", timeZone: "Africa/Johannesburg" });
  assert.deepEqual(request.body.end, { dateTime: "2026-11-05T15:00:00", timeZone: "Africa/Johannesburg" });
  assert.equal(request.body.subject, "Site visit");
  assert.deepEqual(request.body.location, { displayName: "Sandton" });
  assert.deepEqual(request.body.body, { contentType: "text", content: "Bring the plans" });
  assert.equal(request.body.transactionId, "11111111-2222-3333-4444-555555555555");
});

test("guests are cleaned and deduped", () => {
  const request = buildGraphCreate(row());
  assert.ok(!("error" in request));
  assert.deepEqual(request.body.attendees, [
    { emailAddress: { address: "sam@example.com" }, type: "required" },
    { emailAddress: { address: "kim@example.com" }, type: "required" },
  ]);
  assert.deepEqual(buildGraphCreate(row({ attendees: ["not an address"] })), { error: "One of the guests is not a valid email address." });
});

test("an all-day event runs midnight to midnight with the end day excluded", () => {
  const request = buildGraphCreate(row({ all_day: true, starts_at: "2026-11-04T22:00:00.000Z", ends_at: "2026-11-05T22:00:00.000Z" }));
  assert.ok(!("error" in request));
  assert.equal(request.body.isAllDay, true);
  assert.deepEqual(request.body.start, { dateTime: "2026-11-05T00:00:00", timeZone: "Africa/Johannesburg" });
  assert.deepEqual(request.body.end, { dateTime: "2026-11-06T00:00:00", timeZone: "Africa/Johannesburg" });
});

test("another calendar is posted to by its id, encoded", () => {
  assert.equal(createUrl("AAMk/ad=="), "/me/calendars/AAMk%2Fad%3D%3D/events");
});

test("bad times, zones, repeats and unsent invitations are refused before anything is sent", () => {
  assert.deepEqual(buildGraphCreate(row({ time_zone: "Nowhere/Land" })), { error: "This time zone is not recognised." });
  assert.deepEqual(buildGraphCreate(row({ ends_at: "2026-11-05T11:00:00.000Z" })), { error: "The event must end after it starts." });
  assert.deepEqual(buildGraphCreate(row({ recurrence: "FREQ=DAILY" })), { error: RECURRENCE_NOT_SUPPORTED });
  assert.deepEqual(buildGraphCreate(row({ send_invites: false })), { error: INVITES_ALWAYS_SENT });
  assert.ok(!("error" in buildGraphCreate(row({ send_invites: false, attendees: [] }))));
});

test("a delete or an answer to a whole series goes to the series master", () => {
  assert.equal(targetId({ provider_event_id: "occ", series_id: "master" }, true), "master");
  assert.equal(targetId({ provider_event_id: "occ", series_id: "master" }, false), "occ");
  assert.equal(targetId({ provider_event_id: "single", series_id: null }, true), "single");
});

test("refusals are told apart: not allowed, busy and maybe made", () => {
  assert.equal(graphCreateFailure(403, "ErrorAccessDenied"), WRITE_NOT_GRANTED);
  assert.equal(graphCreateFailure(429, null), "Outlook Calendar is busy. Try again in a minute.");
  assert.match(graphCreateFailure(502, null), /may have been created/);
  assert.match(graphCreateFailure(null, null), /may have been created/);
  assert.equal(graphDeleteFailure(403, "ErrorAccessDenied"), WRITE_NOT_GRANTED);
  assert.match(graphDeleteFailure(500, null), /did not delete/);
});
