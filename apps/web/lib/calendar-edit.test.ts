// Tests for calendar-edit.ts: the form an event opens as (and when its time cannot be edited), the update row built from
// a changed form, and the pending changes laid over events. Times use the test machine's zone for local parts and a
// named zone for what is sent, so a run in any zone gives the same answers.

import assert from "node:assert/strict";
import test from "node:test";
import type { CalendarEvent } from "./calendar";
import { applyEdits, buildResponse, buildUpdate, canChangeEvents, formOf, withPatch, type PendingEdit } from "./calendar-edit";

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "e1", accountId: "a1", title: "Review", startsAt: new Date(2026, 10, 4, 9, 0).toISOString(), endsAt: new Date(2026, 10, 4, 10, 0).toISOString(),
  allDay: false, location: null, attendees: [], detailed: true, ...over,
});

test("Google, iCloud and Outlook events can be changed from here, nothing else", () => {
  assert.equal(canChangeEvents("google_calendar"), true);
  assert.equal(canChangeEvents("icloud_calendar"), true);
  assert.equal(canChangeEvents("outlook_calendar"), true);
  assert.equal(canChangeEvents("gmail"), false);
  assert.equal(canChangeEvents(undefined), false);
});

test("a same day event opens with its date and times, and its time can be edited", () => {
  const { form, editableTime } = formOf(event());
  assert.deepEqual([form.date, form.startTime, form.endTime, form.allDay], ["2026-11-04", "09:00", "10:00", false]);
  assert.equal(editableTime, true);
});

test("an overnight event can be edited but one over several days keeps its time", () => {
  assert.equal(formOf(event({ startsAt: new Date(2026, 10, 4, 22).toISOString(), endsAt: new Date(2026, 10, 5, 1).toISOString() })).editableTime, true);
  assert.equal(formOf(event({ startsAt: new Date(2026, 10, 4, 9).toISOString(), endsAt: new Date(2026, 10, 6, 17).toISOString() })).editableTime, false);
});

test("a one day all-day event is editable and a three day one is not", () => {
  const one = formOf(event({ allDay: true, startsAt: "2026-11-04T00:00:00Z", endsAt: "2026-11-05T00:00:00Z" }));
  assert.deepEqual([one.form.date, one.form.allDay, one.editableTime], ["2026-11-04", true, true]);
  assert.equal(formOf(event({ allDay: true, startsAt: "2026-11-04T00:00:00Z", endsAt: "2026-11-07T00:00:00Z" })).editableTime, false);
});

test("a form left as it opened builds no update", () => {
  const e = event({ title: "Review", location: "Office" });
  const result = buildUpdate(e, formOf(e).form, "occurrence", "Africa/Johannesburg", []);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.row, null);
    assert.deepEqual(result.patch, {});
  }
});

test("only the changed fields are sent, with the zone when the time moves", () => {
  const e = event();
  const form = { ...formOf(e).form, title: "Review With Sam", endTime: "11:00" };
  const result = buildUpdate(e, form, "occurrence", "Africa/Johannesburg", []);
  assert.equal(result.ok, true);
  if (!result.ok || !result.row) return assert.fail("expected a row");
  assert.equal(result.row.title, "Review With Sam");
  assert.equal(result.row.location, undefined);
  assert.equal(result.row.time_zone, "Africa/Johannesburg");
  assert.equal(result.row.kind, "update");
  assert.equal(result.patch.title, "Review With Sam");
});

test("a time the form cannot show cannot stop an edit of the title", () => {
  const e = event({ allDay: true, startsAt: "2026-11-04T00:00:00Z", endsAt: "2026-11-07T00:00:00Z" });
  const result = buildUpdate(e, { ...formOf(e).form, title: "Conference 2" }, "series", "Africa/Johannesburg", []);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.row?.title, "Conference 2");
    assert.equal(result.row?.starts_at, undefined);
  }
});

test("an answer to an invitation is a one occurrence rsvp row", () => {
  assert.deepEqual(buildResponse(event(), "tentative"), { account_id: "a1", event_id: "e1", kind: "rsvp", scope: "occurrence", response: "tentative" });
});

test("an answer can be for every event in a series, but only for an event that is in one", () => {
  const inSeries = event({ seriesId: "s1" });
  assert.equal(buildResponse(inSeries, "accepted", "series").scope, "series");
  assert.equal(buildResponse(inSeries, "accepted").scope, "occurrence");
  assert.equal(buildResponse(event(), "accepted", "series").scope, "occurrence");
});

test("a saved change shows on its event, marked as saving, and others are left alone", () => {
  const edits: PendingEdit[] = [{ token: "t", id: "e1", seriesId: null, scope: "occurrence", patch: { title: "New" } }];
  assert.equal(applyEdits(edits, event()).title, "New");
  assert.equal(applyEdits(edits, event()).pending, true);
  const other = event({ id: "e2" });
  assert.equal(applyEdits(edits, other), other);
  assert.equal(withPatch(other, undefined), other);
});

test("a change to a whole series reaches the rest of it except the time", () => {
  const edits: PendingEdit[] = [{ token: "t", id: "e1", seriesId: "s1", scope: "series", patch: { title: "Weekly", startsAt: "2026-11-04T07:00:00.000Z" } }];
  const sibling = event({ id: "e2", seriesId: "s1" });
  const shown = applyEdits(edits, sibling);
  assert.equal(shown.title, "Weekly");
  assert.equal(shown.startsAt, sibling.startsAt);
  assert.equal(applyEdits(edits, event({ id: "e3", seriesId: "s2" })).title, "Review");
});
