// Tests for backfill/calendar.ts: each readable calendar value is sealed under its field and opens back exactly, the guest
// list as one JSON string, queued guests one by one and the join link keys inside a meeting's provider_meta; values
// already sealed and empty ones are left alone, so a second run finds nothing to do.

import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptField, deriveUserKeys, encryptField, isCiphertext, newDataKey } from "@messages/crypto";
import { FIELD } from "@messages/crypto/fields";
import { CALENDAR_SPECS, planCalendarRow } from "./calendar";

const keys = await deriveUserKeys(newDataKey());
const spec = (table: string) => CALENDAR_SPECS.find((s) => s.table === table)!;

test("an event's readable text and guests are sealed, and the write is guarded by updated_at", async () => {
  const guests = [{ email: "sipho@example.co.za", name: "Sipho", self: false }];
  const row = { id: "e", user_id: "u", updated_at: "2026-11-03T10:00:00+00:00", title: await encryptField(keys, FIELD.eventTitle, "Lunch"), location: null, description: "Notes", calendar_name: "Work", conference_url: "https://meet.google.com/abc-defg-hij", resource_url: "", attendees: guests };
  const plan = (await planCalendarRow(keys, spec("calendar_events"), row))!;
  assert.equal(plan.guard, row.updated_at);
  assert.deepEqual(Object.keys(plan.set).sort(), ["attendees", "calendar_name", "conference_url", "description"]);
  assert.equal(await decryptField(keys, FIELD.eventNotes, plan.set.description as string), "Notes");
  assert.equal(await decryptField(keys, FIELD.eventLink, plan.set.conference_url as string), row.conference_url);
  assert.deepEqual(JSON.parse(await decryptField(keys, FIELD.eventGuests, plan.set.attendees as string)), guests);
  // Run again on what it wrote: nothing left to do.
  assert.equal(await planCalendarRow(keys, spec("calendar_events"), { ...row, ...plan.set }), null);
});

test("an empty guest list is left as it is", async () => {
  assert.equal(await planCalendarRow(keys, spec("calendar_events"), { attendees: [], updated_at: "t" }), null);
});

test("a settled queue row has its text and each guest sealed, guarded by its status", async () => {
  const row = { id: "q", user_id: "u", status: "created", title: "Lunch", description: null, location: "Café", attendees: ["thandi@example.com", await encryptField(keys, FIELD.address, "pieter@example.com")] };
  const plan = (await planCalendarRow(keys, spec("calendar_outbox"), row))!;
  assert.equal(plan.guard, "created");
  const list = plan.set.attendees as string[];
  assert.equal(await decryptField(keys, FIELD.address, list[0]), "thandi@example.com");
  assert.equal(list[1], row.attendees[1]);
  assert.equal(await decryptField(keys, FIELD.eventTitle, plan.set.title as string), "Lunch");
  assert.ok(!("description" in plan.set));
  assert.deepEqual(spec("calendar_outbox").settled, ["created", "failed"]);
});

test("a meeting's join link, Meet code and Teams meeting ID are sealed and nothing else in provider_meta", async () => {
  const meta = { join_url: "https://teams.microsoft.com/l/meetup-join/19%3ameeting", online_meeting_id: "MSo1", event_id: "AAMk", transcript_ids: ["t1"] };
  const plan = (await planCalendarRow(keys, spec("meetings"), { provider_meta: meta, updated_at: "t" }))!;
  const next = plan.set.provider_meta as Record<string, unknown>;
  assert.ok(isCiphertext(next.join_url) && isCiphertext(next.online_meeting_id));
  assert.equal(await decryptField(keys, FIELD.eventLink, next.join_url as string), meta.join_url);
  assert.equal(next.event_id, "AAMk");
  assert.deepEqual(next.transcript_ids, ["t1"]);
  assert.equal(await planCalendarRow(keys, spec("meetings"), { provider_meta: next, updated_at: "t" }), null);
  assert.equal(await planCalendarRow(keys, spec("meetings"), { provider_meta: null, updated_at: "t" }), null);
});
