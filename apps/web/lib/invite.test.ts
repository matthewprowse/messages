// Tests for invite.ts: reading an invitation's .ics (Google's, Outlook's with Windows zone names, all-day, cancelled,
// folded and escaped lines) and finding the calendar event it became.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalendarEvent } from "./calendar";
import { inviteAttachment, inviteWhen, isInviteFile, matchInvite, parseInvite } from "./invite";

const GOOGLE = [
  "BEGIN:VCALENDAR", "PRODID:-//Google Inc//Google Calendar 70.9054//EN", "VERSION:2.0", "METHOD:REQUEST", "BEGIN:VEVENT",
  "DTSTART:20261105T120000Z", "DTEND:20261105T130000Z", "UID:abc123@google.com",
  "ORGANIZER;CN=Priya Naidoo:mailto:Priya@Client.com", "ATTENDEE;CUTYPE=INDIVIDUAL;PARTSTAT=NEEDS-ACTION;CN=Me:mailto:me@firm.co.za",
  "SUMMARY:Viewing at 12 Oak Lane\\, Sandton", "LOCATION:12 Oak Lane\\, Sandton", "STATUS:CONFIRMED",
  "BEGIN:VALARM", "TRIGGER:-PT10M", "SUMMARY:Alarm", "END:VALARM", "END:VEVENT", "END:VCALENDAR",
].join("\r\n");

test("a Google invitation is read: title, UTC times, organizer, location, with the alarm left out", () => {
  const invite = parseInvite(GOOGLE);
  assert.ok(invite);
  assert.equal(invite.title, "Viewing at 12 Oak Lane, Sandton");
  assert.equal(invite.startsAt, "2026-11-05T12:00:00.000Z");
  assert.equal(invite.endsAt, "2026-11-05T13:00:00.000Z");
  assert.equal(invite.organizer, "priya@client.com");
  assert.equal(invite.method, "REQUEST");
  assert.equal(invite.cancelled, false);
  assert.equal(invite.location, "12 Oak Lane, Sandton");
  assert.equal(invite.uid, "abc123@google.com");
});

test("an Outlook invitation names its zone the Windows way, and the time is that zone's", () => {
  const ics = ["BEGIN:VCALENDAR", "METHOD:REQUEST", "BEGIN:VEVENT", "DTSTART;TZID=South Africa Standard Time:20261105T140000", "DTEND;TZID=\"South Africa Standard Time\":20261105T150000", "SUMMARY:Quote review", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const invite = parseInvite(ics);
  assert.equal(invite?.startsAt, "2026-11-05T12:00:00.000Z");
  const newYork = parseInvite(ics.replace(/South Africa Standard Time/g, "Eastern Standard Time"));
  assert.equal(newYork?.startsAt, "2026-11-05T19:00:00.000Z"); // 14:00 at UTC-5 after the clock change
  assert.equal(parseInvite(ics.replace(/South Africa Standard Time/g, "Nowhere Time")), null);
});

test("an all-day invitation, a cancellation, a repeat and folded lines are read", () => {
  const allDay = parseInvite("BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:20261105\nSUMMARY:Off-site\nEND:VEVENT\nEND:VCALENDAR");
  assert.equal(allDay?.allDay, true);
  assert.equal(allDay?.startsAt, "2026-11-05T00:00:00Z");
  const cancelled = parseInvite("BEGIN:VCALENDAR\nMETHOD:CANCEL\nBEGIN:VEVENT\nDTSTART:20261105T120000Z\nSUMMARY:Gone\nEND:VEVENT\nEND:VCALENDAR");
  assert.equal(cancelled?.cancelled, true);
  const repeating = parseInvite("BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20261105T120000Z\nRRULE:FREQ=WEEKLY\nSUMMARY:Stand-up\nEND:VEVENT\nEND:VCALENDAR");
  assert.equal(repeating?.repeats, true);
  const folded = parseInvite("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261105T120000Z\r\nSUMMARY:A very long\r\n  title that was folded\r\nEND:VEVENT\r\nEND:VCALENDAR");
  assert.equal(folded?.title, "A very long title that was folded");
});

test("a file with no event, or an event with no readable start, is not an invitation", () => {
  assert.equal(parseInvite("BEGIN:VCALENDAR\nEND:VCALENDAR"), null);
  assert.equal(parseInvite("BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:No start\nEND:VEVENT\nEND:VCALENDAR"), null);
  assert.equal(parseInvite("not a calendar"), null);
});

test("the invitation file is the .ics among a message's attachments", () => {
  const file = (name: string) => ({ id: name, name, kind: "file" as const, size: "1 KB" });
  assert.ok(isInviteFile(file("invite.ics")));
  assert.ok(isInviteFile(file("Meeting.ICS ")));
  assert.ok(!isInviteFile(file("invite.pdf")));
  assert.equal(inviteAttachment([file("a.pdf"), file("invite.ics")])?.name, "invite.ics");
  assert.equal(inviteAttachment(undefined), undefined);
});

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "e1", title: "Viewing at 12 Oak Lane, Sandton", startsAt: "2026-11-05T12:00:00.000Z", endsAt: "2026-11-05T13:00:00.000Z", allDay: false, location: null, attendees: [], ...over,
});

test("the invitation is the event with the same start and title, ignoring case and spacing", () => {
  const invite = parseInvite(GOOGLE)!;
  assert.equal(matchInvite(invite, [event({ id: "other", startsAt: "2026-11-05T13:00:00.000Z" }), event({ title: " viewing at 12 OAK Lane,  Sandton " })])?.id, "e1");
  assert.equal(matchInvite(invite, [event({ startsAt: "2026-11-05T13:00:00.000Z" })]), null);
});

test("a retitled event still matches when it is the organizer's only event at that time", () => {
  const invite = parseInvite(GOOGLE)!;
  const retitled = event({ title: "Viewing (moved venue)", organizer: { name: "Priya", email: "priya@client.com" } });
  assert.equal(matchInvite(invite, [retitled])?.id, "e1");
  assert.equal(matchInvite(invite, [retitled, { ...retitled, id: "e2" }]), null);
  assert.equal(matchInvite(invite, [event({ title: "Something else" })]), null);
});

test("an all-day invitation matches an all-day event on its date only", () => {
  const invite = parseInvite("BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:20261105\nSUMMARY:Off-site\nEND:VEVENT\nEND:VCALENDAR")!;
  assert.equal(matchInvite(invite, [event({ id: "d", title: "Off-site", allDay: true, startsAt: "2026-11-05T00:00:00Z" })])?.id, "d");
  assert.equal(matchInvite(invite, [event({ title: "Off-site", allDay: false, startsAt: "2026-11-05T00:00:00Z" })]), null);
});

test("the card says when in the viewer's zone, and an all-day invitation says the day only", () => {
  assert.equal(inviteWhen(parseInvite(GOOGLE)!, "Africa/Johannesburg"), "Thursday 5 November, 14:00 to 15:00");
  assert.equal(inviteWhen(parseInvite(GOOGLE)!, "America/New_York"), "Thursday 5 November, 07:00 to 08:00");
  const allDay = parseInvite("BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:20261105\nSUMMARY:Off-site\nEND:VEVENT\nEND:VCALENDAR")!;
  assert.equal(inviteWhen(allDay, "America/New_York"), "Thursday 5 November");
});
