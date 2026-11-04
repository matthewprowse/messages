// Tests for lib/calendar-seal.ts: a queued new event or change has its title, place, notes and every guest sealed under
// the right field and for its own column, while columns left out or null (unchanged, in a change) stay so and the rest of
// the row is untouched.

import assert from "node:assert/strict";
import { test } from "node:test";
import { FIELD } from "@messages/crypto/fields";
import { sealQueuedEvent, type QueueSealers } from "./calendar-seal";

const sealers: QueueSealers = {
  text: async (field, value, column) => `sealed:${field}:${column}:${value}`,
  address: async (value, column) => `addr:${column}:${value}`,
};

test("a new event's text and every guest are sealed, and the rest of the row is untouched", async () => {
  const row = { account_id: "a", title: "Lunch", description: null, location: "Café", starts_at: "2026-11-04T10:00:00.000Z", attendees: ["thandi@example.com", "pieter@example.com"], send_invites: true };
  const sealed = await sealQueuedEvent(row, sealers);
  assert.deepEqual(sealed, {
    ...row,
    title: `sealed:${FIELD.eventTitle}:title:Lunch`,
    location: `sealed:${FIELD.eventLocation}:location:Café`,
    attendees: ["addr:attendees:thandi@example.com", "addr:attendees:pieter@example.com"],
  });
  assert.equal(row.title, "Lunch"); // the page still shows the plain row meanwhile
});

test("a change seals only what it changes, and an empty value (clear it) is sealed too", async () => {
  const sealed = await sealQueuedEvent({ event_id: "e", kind: "update", description: "" }, sealers);
  assert.deepEqual(sealed, { event_id: "e", kind: "update", description: `sealed:${FIELD.eventNotes}:description:` });
  assert.ok(!("title" in sealed) && !("attendees" in sealed));
});
