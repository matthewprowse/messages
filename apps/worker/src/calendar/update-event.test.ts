import assert from "node:assert/strict";
import { test } from "node:test";
import {
  exactTimes,
  googleBody,
  googleNeedsRead,
  googleUpdateFailure,
  graphBody,
  guestsAfter,
  mergeGoogleGuests,
  readChange,
  seriesShift,
  shiftedTimes,
  storedPatch,
  wallMs,
  wallString,
  wallToIso,
  type CalendarUpdateRow,
  type Change,
} from "./update-event";

function row(patch: Partial<CalendarUpdateRow> = {}): CalendarUpdateRow {
  return {
    id: "1", user_id: "u", account_id: "a", event_id: "e", kind: "update", scope: "occurrence", title: null, description: null, location: null,
    starts_at: null, ends_at: null, all_day: null, time_zone: null, attendees: null, send_invites: true, response: null, status: "queued", error: null,
    created_at: "2026-10-26T08:00:00Z", done_at: null, ...patch,
  };
}

const ok = (c: ReturnType<typeof readChange>): Change => {
  assert.ok(!("error" in c), "error" in c ? c.error : "");
  return c as Change;
};

const JNB = "Africa/Johannesburg";

test("readChange reads details, times and guests", () => {
  const c = ok(readChange(row({ title: "Lunch", starts_at: "2026-11-04T10:00:00Z", ends_at: "2026-11-04T11:00:00Z", all_day: false, time_zone: JNB, attendees: [" Ann@Example.com", "ann@example.com"] })));
  assert.equal(c.title, "Lunch");
  assert.equal(c.time?.allDay, false);
  assert.deepEqual(c.attendees, ["ann@example.com"]);
});

test("readChange refuses a bad zone, backwards times, a bad guest and an unknown answer", () => {
  assert.ok("error" in readChange(row({ title: "x", starts_at: "2026-11-04T10:00:00Z", ends_at: "2026-11-04T11:00:00Z", all_day: false, time_zone: "Nowhere/Land" })));
  assert.ok("error" in readChange(row({ starts_at: "2026-11-04T11:00:00Z", ends_at: "2026-11-04T10:00:00Z", all_day: false, time_zone: JNB })));
  assert.ok("error" in readChange(row({ attendees: ["not an email"] })));
  assert.ok("error" in readChange(row({ kind: "rsvp", response: null })));
  assert.equal(ok(readChange(row({ kind: "rsvp", response: "tentative" }))).response, "tentative");
});

test("wall clocks round trip through a zone, also across a clock change", () => {
  assert.equal(wallString(wallMs("2026-10-26T07:00:00Z", JNB)), "2026-10-26T09:00:00");
  assert.equal(wallToIso(Date.UTC(2026, 9, 26, 9, 0, 0), JNB), "2026-10-26T07:00:00.000Z");
  // New York leaves summer time on 1 November 2026: 09:00 stays 09:00 on the wall.
  assert.equal(wallString(wallMs("2026-11-02T14:00:00Z", "America/New_York")), "2026-11-02T09:00:00");
  assert.equal(wallToIso(Date.UTC(2026, 10, 2, 9, 0, 0), "America/New_York"), "2026-11-02T14:00:00.000Z");
  assert.equal(wallToIso(Date.UTC(2026, 9, 30, 9, 0, 0), "America/New_York"), "2026-10-30T13:00:00.000Z");
});

const timed = (startsAt: string, endsAt: string, timeZone = JNB) => ({ startsAt: new Date(startsAt), endsAt: new Date(endsAt), allDay: false, timeZone });

test("a series moves by the wall clock of the occurrence that was changed", () => {
  const stored = { starts_at: "2026-11-02T07:00:00.000Z", ends_at: "2026-11-02T08:00:00.000Z", all_day: false };
  const shift = seriesShift(timed("2026-11-02T08:30:00Z", "2026-11-02T10:00:00Z"), stored);
  assert.ok(!("error" in shift));
  if ("error" in shift) return;
  assert.equal(shift.kind, "time");
  const other = shiftedTimes({ starts_at: "2026-11-09T07:00:00.000Z", all_day: false }, shift);
  assert.equal(other.starts_at, "2026-11-09T08:30:00.000Z");
  assert.equal(other.ends_at, "2026-11-09T10:00:00.000Z");
});

test("a series moved across a clock change keeps its local time", () => {
  const stored = { starts_at: "2026-10-26T13:00:00.000Z", ends_at: "2026-10-26T14:00:00.000Z", all_day: false }; // 09:00 in New York
  const shift = seriesShift(timed("2026-10-26T14:00:00Z", "2026-10-26T15:00:00Z", "America/New_York"), stored);
  assert.ok(!("error" in shift));
  if ("error" in shift) return;
  const later = shiftedTimes({ starts_at: "2026-11-02T14:00:00.000Z", all_day: false }, shift); // 09:00 after the change
  assert.equal(later.starts_at, "2026-11-02T15:00:00.000Z"); // 10:00 New York
});

test("an all-day series shifts by days", () => {
  const stored = { starts_at: "2026-11-02T00:00:00Z", ends_at: "2026-11-03T00:00:00Z", all_day: true };
  const time = { startsAt: new Date("2026-11-03T00:00:00Z"), endsAt: new Date("2026-11-05T00:00:00Z"), allDay: true, timeZone: "UTC" };
  const shift = seriesShift(time, stored);
  assert.ok(!("error" in shift));
  if ("error" in shift) return;
  assert.deepEqual(shiftedTimes({ starts_at: "2026-11-09T00:00:00Z", all_day: true }, shift), { starts_at: "2026-11-10T00:00:00Z", ends_at: "2026-11-12T00:00:00Z", all_day: true });
  assert.deepEqual(exactTimes(time), { starts_at: "2026-11-03T00:00:00Z", ends_at: "2026-11-05T00:00:00Z", all_day: true });
  assert.ok("error" in seriesShift(timed("2026-11-03T10:00:00Z", "2026-11-03T11:00:00Z"), stored));
});

test("the stored event gets the change, with guests keeping their answers", () => {
  const stored = { attendees: [{ email: "me@x.com", self: true, response: "accepted" }, { email: "ann@x.com", response: "accepted" }, { email: "bob@x.com", response: "declined" }] };
  const patch = storedPatch(stored, ok(readChange(row({ title: "T", location: "", description: "D", attendees: ["ann@x.com", "cy@x.com"] }))), null);
  assert.equal(patch.title, "T");
  assert.equal(patch.location, null);
  assert.equal(patch.description, "D");
  const guests = patch.attendees as { email: string; response: string }[];
  assert.deepEqual(guests.map((g) => g.email), ["me@x.com", "ann@x.com", "cy@x.com"]);
  assert.equal(guests[1].response, "accepted");
  assert.equal(guests[2].response, "needsAction");
  const answered = guestsAfter(stored.attendees as never, undefined, "declined") as { self?: boolean; response: string }[];
  assert.equal(answered.find((g) => g.self)!.response, "declined");
  assert.equal(answered.find((g) => !g.self && g.response === "accepted") !== undefined, true);
});

test("Google: details become a patch, empty text clears", () => {
  const c = ok(readChange(row({ title: "Lunch", location: "", description: "Plan", starts_at: "2026-11-04T10:00:00Z", ends_at: "2026-11-04T11:00:00Z", all_day: false, time_zone: JNB })));
  assert.equal(googleNeedsRead(c, false), false);
  const r = googleBody(c, null, null);
  assert.ok("body" in r);
  if (!("body" in r)) return;
  assert.deepEqual(r.body, {
    summary: "Lunch",
    location: "",
    description: "Plan",
    start: { dateTime: "2026-11-04T10:00:00.000Z", timeZone: JNB },
    end: { dateTime: "2026-11-04T11:00:00.000Z", timeZone: JNB },
  });
});

test("Google: an all-day event is sent as dates", () => {
  const c = ok(readChange(row({ starts_at: "2026-11-03T22:00:00Z", ends_at: "2026-11-04T22:00:00Z", all_day: true, time_zone: JNB })));
  const r = googleBody(c, null, null);
  assert.ok("body" in r);
  if (!("body" in r)) return;
  assert.deepEqual(r.body, { start: { date: "2026-11-04" }, end: { date: "2026-11-05" } });
});

test("Google: a new guest list keeps your entry, the organizer, rooms and answers", () => {
  const current = [
    { email: "me@x.com", self: true, organizer: true, responseStatus: "accepted" },
    { email: "ann@x.com", responseStatus: "accepted" },
    { email: "bob@x.com", responseStatus: "declined" },
    { email: "room@x.com", resource: true },
  ];
  const merged = mergeGoogleGuests(current, ["ann@x.com", "cy@x.com"]);
  assert.deepEqual(merged.map((a) => a.email), ["me@x.com", "ann@x.com", "room@x.com", "cy@x.com"]);
  assert.equal(merged[1].responseStatus, "accepted");
  assert.deepEqual(merged[3], { email: "cy@x.com" });
  const c = ok(readChange(row({ attendees: [] })));
  assert.equal(googleNeedsRead(c, false), true);
  const r = googleBody(c, { attendees: current }, null);
  assert.ok("body" in r);
  if (!("body" in r)) return;
  assert.deepEqual(r.body.attendees?.map((a) => a.email), ["me@x.com", "room@x.com"]);
});

test("Google: an answer changes only your own entry", () => {
  const c = ok(readChange(row({ kind: "rsvp", response: "tentative" })));
  const guests = [{ email: "boss@x.com", organizer: true, responseStatus: "accepted" }, { email: "me@x.com", self: true, responseStatus: "needsAction" }];
  const r = googleBody(c, { attendees: guests }, null);
  assert.ok("body" in r);
  if (!("body" in r)) return;
  assert.deepEqual(r.body, { attendees: [guests[0], { email: "me@x.com", self: true, responseStatus: "tentative" }] });
  assert.ok("error" in googleBody(c, { attendees: [guests[0]] }, null));
  assert.ok("error" in googleBody(c, {}, null));
});

test("Google: a whole-series time change moves the series' own start in its own zone", () => {
  const stored = { starts_at: "2026-11-02T07:00:00.000Z", ends_at: "2026-11-02T08:00:00.000Z", all_day: false };
  const c = ok(readChange(row({ scope: "series", starts_at: "2026-11-02T08:30:00Z", ends_at: "2026-11-02T10:00:00Z", all_day: false, time_zone: JNB })));
  const shift = seriesShift(c.time!, stored);
  assert.ok(!("error" in shift));
  if ("error" in shift) return;
  assert.equal(googleNeedsRead(c, true), true);
  const master = { start: { dateTime: "2026-10-26T09:00:00+02:00", timeZone: JNB }, end: { dateTime: "2026-10-26T10:00:00+02:00", timeZone: JNB } };
  const r = googleBody(c, master, shift);
  assert.ok("body" in r);
  if (!("body" in r)) return;
  assert.deepEqual(r.body.start, { dateTime: "2026-10-26T10:30:00", timeZone: JNB });
  assert.deepEqual(r.body.end, { dateTime: "2026-10-26T12:00:00", timeZone: JNB });
  assert.ok("error" in googleBody(c, { start: { date: "2026-10-26" } }, shift));
});

test("Google: refusals say what they mean", () => {
  assert.match(googleUpdateFailure(403, "insufficientPermissions"), /Reconnect Google/);
  assert.match(googleUpdateFailure(403, "forbidden"), /cannot change/);
  assert.match(googleUpdateFailure(404, null), /no longer exists/);
  assert.match(googleUpdateFailure(429, null), /busy/);
  assert.match(googleUpdateFailure(null, null), /did not accept|did not respond/);
});

test("Outlook: details become a patch and the guest list keeps who stays", () => {
  const c = ok(readChange(row({ title: "T", location: "Room", description: "D", starts_at: "2026-11-04T10:00:00Z", ends_at: "2026-11-04T11:00:00Z", all_day: false, time_zone: JNB, attendees: ["ann@x.com", "cy@x.com"] })));
  const r = graphBody(c, [{ emailAddress: { address: "Ann@x.com" }, type: "optional" }, { emailAddress: { address: "bob@x.com" }, type: "required" }]);
  assert.ok("body" in r);
  if (!("body" in r)) return;
  assert.equal(r.body.subject, "T");
  assert.deepEqual(r.body.location, { displayName: "Room" });
  assert.deepEqual(r.body.body, { contentType: "text", content: "D" });
  assert.deepEqual(r.body.start, { dateTime: "2026-11-04T12:00:00", timeZone: JNB });
  assert.equal(r.body.isAllDay, false);
  const guests = r.body.attendees as { emailAddress: { address: string }; type: string }[];
  assert.deepEqual(guests.map((g) => g.emailAddress.address), ["Ann@x.com", "cy@x.com"]);
  assert.equal(guests[0].type, "optional");
});
