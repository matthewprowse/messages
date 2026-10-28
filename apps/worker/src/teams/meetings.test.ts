// Tests for teams/meetings.ts: which calendar events count as Teams meetings, who was in them, and when a
// transcript is still looked for.

import assert from "node:assert/strict";
import { test } from "node:test";
import { GIVE_UP_MS, gaveUp, joinUrlFilter, meetingPeople, newSpeakers, teamsMeetings, transcriptCheckDue, transcriptsFor, type MeetingEvent } from "./meetings";

const self = { name: "Matt Prowse", addresses: new Set(["matt@contoso.com"]) };
const JOIN = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_NzQ1@thread.v2/0?context=%7b%22Tid%22%3a%22t%22%7d";

// Read with Prefer: outlook.timezone="UTC", as the connector does.
const event = (over: Partial<MeetingEvent> = {}): MeetingEvent => ({
  id: "AAMkAGI2TG93AAA=",
  iCalUId: "040000008200E00074C5B7101A82E008",
  subject: "Offer review",
  isAllDay: false,
  isCancelled: false,
  start: { dateTime: "2026-10-26T08:00:00.0000000", timeZone: "UTC" },
  end: { dateTime: "2026-10-26T08:30:00.0000000", timeZone: "UTC" },
  isOnlineMeeting: true,
  onlineMeetingProvider: "teamsForBusiness",
  onlineMeeting: { joinUrl: JOIN },
  responseStatus: { response: "accepted" },
  organizer: { emailAddress: { name: "Thabo Nkosi", address: "Thabo@Contoso.com" } },
  attendees: [
    { type: "required", emailAddress: { name: "Matt Prowse", address: "matt@contoso.com" } },
    { type: "required", emailAddress: { name: "Thabo Nkosi", address: "thabo@contoso.com" } },
    { type: "resource", emailAddress: { name: "Boardroom", address: "boardroom@contoso.com" } },
    { type: "optional", emailAddress: { name: "Lerato Dlamini", address: "lerato@client.co.za" } },
  ],
  ...over,
});

const NOW = Date.parse("2026-10-26T09:00:00Z");

test("Teams meetings that have started come from the calendar", () => {
  const [m] = teamsMeetings([event()], NOW, self);
  assert.equal(m.eventId, "AAMkAGI2TG93AAA=");
  assert.equal(m.title, "Offer review");
  assert.equal(m.joinUrl, JOIN);
  assert.equal(m.startedAt, Date.parse("2026-10-26T08:00:00Z"));
  assert.equal(m.endedAt, Date.parse("2026-10-26T08:30:00Z"));
  assert.deepEqual(m.people, [
    { name: "Thabo Nkosi", email: "thabo@contoso.com", self: false },
    { name: "Matt Prowse", email: "matt@contoso.com", self: true },
    { name: "Lerato Dlamini", email: "lerato@client.co.za", self: false },
  ]);
});

test("cancelled, declined, future, all-day and other platforms' meetings are left out", () => {
  const events = [
    event({ id: "cancelled", isCancelled: true }),
    event({ id: "declined", responseStatus: { response: "declined" } }),
    event({ id: "future", start: { dateTime: "2026-10-26T10:00:00.0000000" }, end: { dateTime: "2026-10-26T11:00:00.0000000" } }),
    event({ id: "allday", isAllDay: true }),
    event({ id: "zoom", onlineMeetingProvider: "unknown", onlineMeeting: { joinUrl: "https://zoom.us/j/123" } }),
    event({ id: "skype", onlineMeetingProvider: "skypeForConsumer" }),
    event({ id: "nolink", onlineMeeting: null }),
    event({ id: "offline", isOnlineMeeting: false }),
    event({ id: "kept" }),
  ];
  assert.deepEqual(teamsMeetings(events, NOW, self).map((m) => m.eventId), ["kept"]);
});

test("a meeting without a provider counts when its link is a Teams one", () => {
  assert.equal(teamsMeetings([event({ onlineMeetingProvider: null })], NOW, self).length, 1);
  assert.equal(teamsMeetings([event({ onlineMeetingProvider: null, onlineMeeting: { joinUrl: "https://meet.google.com/abc" } })], NOW, self).length, 0);
});

test("you are in the people even when the invitation leaves you out", () => {
  const people = meetingPeople(event({ attendees: [] }), self);
  assert.deepEqual(people, [
    { name: "Thabo Nkosi", email: "thabo@contoso.com", self: false },
    { name: "Matt Prowse", email: "matt@contoso.com", self: true },
  ]);
});

test("the join link filter doubles quotes", () => {
  assert.equal(joinUrlFilter("https://x/it's"), "JoinWebUrl eq 'https://x/it''s'");
});

test("a repeating meeting's transcripts are matched to the right occurrence", () => {
  const list = [
    { id: "last-week", createdDateTime: "2026-10-19T08:02:00Z", endDateTime: "2026-10-19T08:29:00Z" },
    { id: "second", createdDateTime: "2026-10-26T08:20:00Z", endDateTime: "2026-10-26T08:31:00Z" },
    { id: "first", createdDateTime: "2026-10-26T08:01:00Z", endDateTime: "2026-10-26T08:15:00Z" },
  ];
  const occurrence = { startedAt: Date.parse("2026-10-26T08:00:00Z"), endedAt: Date.parse("2026-10-26T08:30:00Z") };
  const found = transcriptsFor(list, occurrence);
  assert.deepEqual(found.transcripts.map((t) => t.id), ["first", "second"]);
  assert.equal(found.finished, true);
  assert.equal(transcriptsFor([{ id: "live", createdDateTime: "2026-10-26T08:01:00Z", endDateTime: null }], occurrence).finished, false);
  assert.deepEqual(transcriptsFor([], occurrence), { transcripts: [], finished: true });
});

test("transcripts are looked for soon after the meeting, then less often, then not at all", () => {
  const end = Date.parse("2026-10-26T08:30:00Z");
  assert.equal(transcriptCheckDue(end, end - 60_000, undefined), false, "still going");
  assert.equal(transcriptCheckDue(end, end + 60_000, undefined), true, "never checked");
  assert.equal(transcriptCheckDue(end, end + 15 * 60_000, end + 10 * 60_000), false);
  assert.equal(transcriptCheckDue(end, end + 21 * 60_000, end + 10 * 60_000), true);
  assert.equal(transcriptCheckDue(end, end + 3 * 3_600_000, end + 3 * 3_600_000 - 15 * 60_000), false, "half-hourly later on");
  assert.equal(transcriptCheckDue(end, end + 3 * 3_600_000, end + 3 * 3_600_000 - 31 * 60_000), true);
  assert.equal(gaveUp(end, end + GIVE_UP_MS - 1), false);
  assert.equal(gaveUp(end, end + GIVE_UP_MS + 1), true);
});

test("speakers not among the attendees are added once each", () => {
  const segments = [
    { speaker: "Thabo Nkosi", start_ms: 0, text: "Hi." },
    { speaker: "Guest Caller", start_ms: 1, text: "Hello." },
    { speaker: null, start_ms: 2, text: "..." },
    { speaker: "thabo  nkosi", start_ms: 3, text: "Again." },
    { speaker: "Guest Caller", start_ms: 4, text: "Me again." },
    { speaker: "Zoë Adams", start_ms: 5, text: "Hi." },
  ];
  assert.deepEqual(newSpeakers(segments, ["Thabo Nkosi", null, "Zoe Adams"]), ["Guest Caller"]);
});
