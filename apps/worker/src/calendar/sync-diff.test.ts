import assert from "node:assert/strict";
import { test } from "node:test";
import { eventChanged, type StoredEvent } from "./sync-diff";

const stored: StoredEvent = {
  provider_event_id: "e1",
  calendar_id: "primary",
  title: "Standup",
  starts_at: "2026-10-23T08:00:00+00:00",
  ends_at: "2026-10-23T08:15:00+00:00",
  all_day: false,
  location: null,
  attendees: [{ email: "a@x.com", name: null, response: "accepted", self: false, organizer: true }],
};
const fetched = {
  user_id: "u",
  account_id: "acc",
  calendar_id: "primary",
  provider_event_id: "e1",
  title: "Standup",
  starts_at: "2026-10-23T08:00:00.000Z",
  ends_at: "2026-10-23T08:15:00.000Z",
  all_day: false,
  location: null,
  attendees: [{ email: "a@x.com", name: null, response: "accepted", self: false, organizer: true }],
};

test("an unchanged event is not written again, whatever the time format", () => {
  assert.equal(eventChanged(stored, fetched), false);
});

test("new and changed events are written", () => {
  assert.equal(eventChanged(undefined, fetched), true);
  assert.equal(eventChanged(stored, { ...fetched, title: "Standup (moved)" }), true);
  assert.equal(eventChanged(stored, { ...fetched, starts_at: "2026-10-23T09:00:00.000Z" }), true);
  assert.equal(eventChanged(stored, { ...fetched, ends_at: null }), true);
  assert.equal(eventChanged(stored, { ...fetched, location: "Room 2" }), true);
  assert.equal(eventChanged(stored, { ...fetched, attendees: [] }), true);
  assert.equal(eventChanged(stored, { ...fetched, calendar_id: "work" }), true);
});
