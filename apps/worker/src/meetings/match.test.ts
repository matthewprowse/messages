import { test } from "node:test";
import assert from "node:assert/strict";
import { eventEmails, joinKey, matchEvent, participantEmail, type EventFacts, type MeetingFacts } from "./match";

const at = (hhmm: string, day = "2026-10-27") => new Date(`${day}T${hhmm}:00+02:00`).toISOString();

function event(id: string, patch: Partial<EventFacts> = {}): EventFacts {
  return { id, startsAt: at("10:00"), endsAt: at("11:00"), allDay: false, conferenceUrl: null, emails: [], ...patch };
}

function meeting(patch: Partial<MeetingFacts> = {}): MeetingFacts {
  return { startedAt: at("10:02"), endedAt: at("10:48"), joinUrl: null, emails: [], ...patch };
}

test("participant emails are bare lowercase addresses", () => {
  assert.equal(participantEmail(" Sarah.Lee@Example.co.za "), "sarah.lee@example.co.za");
  assert.equal(participantEmail("Sarah Lee <sarah@example.com>"), "sarah@example.com");
  assert.equal(participantEmail("mailto:sarah@example.com"), "sarah@example.com");
  assert.equal(participantEmail("Sarah Lee"), null);
  assert.equal(participantEmail("+27821234567"), null);
  assert.equal(participantEmail(null), null);
});

test("join links compare by what identifies the meeting", () => {
  assert.equal(joinKey("https://us02web.zoom.us/j/81234567890?pwd=abc"), "zoom:81234567890");
  assert.equal(joinKey("https://zoom.us/j/81234567890"), "zoom:81234567890");
  assert.equal(joinKey("https://zoom.us/wc/81234567890/join?pwd=x"), "zoom:81234567890");
  assert.equal(joinKey("https://zoom.us/my/SarahLee"), "zoom:my:sarahlee");
  assert.equal(joinKey("https://meet.google.com/ABC-defg-hij?authuser=0"), "meet:abc-defg-hij");
  assert.equal(joinKey("https://meet.google.com/abc-defg-hij"), "meet:abc-defg-hij");
  const teams = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_NjQ2YzE%40thread.v2/0?context=%7b%22Tid%22%7d";
  assert.equal(joinKey(teams), "teams:19:meeting_NjQ2YzE@thread.v2");
  assert.equal(joinKey("https://teams.microsoft.com/l/meetup-join/19:meeting_NjQ2YzE@thread.v2/0"), "teams:19:meeting_NjQ2YzE@thread.v2");
  assert.equal(joinKey("https://teams.microsoft.com/meet/3561234567?p=abc"), "teams:meet:3561234567");
  assert.equal(joinKey("https://www.Example.com/Room/"), "example.com/room");
  assert.equal(joinKey("not a link"), null);
  assert.equal(joinKey("ftp://zoom.us/j/81234567890"), null);
  assert.equal(joinKey(null), null);
});

test("a meeting matches the event with the same join link", () => {
  const events = [
    event("other", { emails: ["sarah@example.com"] }),
    event("linked", { startsAt: at("09:30"), endsAt: at("10:00"), conferenceUrl: "https://us02web.zoom.us/j/81234567890?pwd=abc" }),
  ];
  assert.equal(matchEvent(meeting({ joinUrl: "https://zoom.us/j/81234567890", emails: ["sarah@example.com"] }), events), "linked");
});

test("a repeating meeting's link picks the occurrence that starts nearest", () => {
  const url = "https://meet.google.com/abc-defg-hij";
  const events = [
    event("yesterday", { startsAt: at("10:00", "2026-10-26"), endsAt: at("10:30", "2026-10-26"), conferenceUrl: url }),
    event("today", { startsAt: at("10:00"), endsAt: at("10:30"), conferenceUrl: url }),
    event("tomorrow", { startsAt: at("10:00", "2026-10-28"), endsAt: at("10:30", "2026-10-28"), conferenceUrl: url }),
  ];
  assert.equal(matchEvent(meeting({ joinUrl: url }), events), "today");
  // An occurrence too far away is not the same meeting.
  assert.equal(matchEvent(meeting({ joinUrl: url }), [events[0]]), null);
});

test("without a link, time and shared guests decide", () => {
  const events = [
    event("strangers", { emails: ["someone@else.com"] }),
    event("one", { emails: ["sarah@example.com"] }),
    event("two", { emails: ["sarah@example.com", "tom@example.com"] }),
  ];
  assert.equal(matchEvent(meeting({ emails: ["Sarah@Example.com", "tom@example.com"] }), events), "two");
  assert.equal(matchEvent(meeting({ emails: ["sarah@example.com"] }), events), "one");
  // A different link falls back to time and guests too.
  assert.equal(matchEvent(meeting({ joinUrl: "https://zoom.us/j/99999999999", emails: ["sarah@example.com"] }), [events[1]]), "one");
});

test("time alone is not enough, and neither are guests at another time", () => {
  assert.equal(matchEvent(meeting(), [event("e", { emails: ["sarah@example.com"] })]), null);
  const later = event("later", { startsAt: at("14:00"), endsAt: at("15:00"), emails: ["sarah@example.com"] });
  assert.equal(matchEvent(meeting({ emails: ["sarah@example.com"] }), [later]), null);
  const allDay = event("all_day", { startsAt: "2026-10-27T00:00:00.000Z", endsAt: "2026-10-28T00:00:00.000Z", allDay: true, emails: ["sarah@example.com"] });
  assert.equal(matchEvent(meeting({ emails: ["sarah@example.com"] }), [allDay]), null);
});

test("joining a little early or late still overlaps", () => {
  const e = event("e", { startsAt: at("10:00"), endsAt: at("10:30"), emails: ["sarah@example.com"] });
  // Started ten minutes after the event's end and ran on: within the slack.
  assert.equal(matchEvent(meeting({ startedAt: at("10:40"), endedAt: at("11:00"), emails: ["sarah@example.com"] }), [e]), "e");
  // A meeting with no end yet counts as half an hour from its start.
  assert.equal(matchEvent(meeting({ startedAt: at("09:50"), endedAt: null, emails: ["sarah@example.com"] }), [e]), "e");
  assert.equal(matchEvent(meeting({ startedAt: at("11:00"), endedAt: at("11:30"), emails: ["sarah@example.com"] }), [e]), null);
});

test("with equal guests, more overlap and then the nearer start win", () => {
  const who = ["sarah@example.com"];
  const events = [event("short", { startsAt: at("10:30"), endsAt: at("10:45"), emails: who }), event("full", { emails: who })];
  assert.equal(matchEvent(meeting({ emails: who }), events), "full");
});

test("an event's guests leave you out", () => {
  assert.deepEqual(
    eventEmails([
      { email: "Sarah@Example.com", self: false },
      { email: "me@example.com", self: true },
      { name: "No Address" },
      "nonsense",
    ]),
    ["sarah@example.com"],
  );
  assert.deepEqual(eventEmails(null), []);
});
