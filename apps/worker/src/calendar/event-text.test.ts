// Tests for calendar/event-text.ts: an event's text and guest list seal under their own fields and open back to the same
// row (so the sync sees no change), sealing off leaves the guest list a list, and a queued row opens with every guest or
// fails with a reason, never dropping one, and is checked against the limits the table used to hold.

import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptField, deriveUserKeys, encryptAt, encryptField, isCiphertext, newDataKey, openExpected } from "@messages/crypto";
import { FIELD, type Field } from "@messages/crypto/fields";
import { eventChanged } from "./sync-diff";
import { MAX_TITLE, UNREADABLE, guestList, openEventText, openQueuedText, sealEventText } from "./event-text";

const keys = await deriveUserKeys(newDataKey());
const seal = (field: Field, value: string | null) => (value == null ? Promise.resolve(null) : encryptField(keys, field, value));
const open = async (field: Field, value: string | null) => (value != null && isCiphertext(value) ? decryptField(keys, field, value) : value);
const plainSeal = async (_field: Field, value: string | null) => value;

const fetched = {
  user_id: "u",
  account_id: "acc",
  calendar_id: "work@example.com",
  provider_event_id: "e1",
  title: "Offer review",
  starts_at: "2026-11-04T08:00:00.000Z",
  ends_at: "2026-11-04T09:00:00.000Z",
  all_day: false,
  location: "Office",
  attendees: [{ email: "sipho@example.co.za", name: "Sipho", response: "accepted", self: false, organizer: true }],
  description: "Bring the signed offer.",
  calendar_name: "Work",
  conference_url: "https://us02web.zoom.us/j/81234567890",
  resource_url: "https://p01-caldav.icloud.com/123/calendars/home/e1.ics",
  series_id: null,
  recurrence: null,
};

test("every text column and the guest list are sealed under their own field", async () => {
  const sealed = await sealEventText(fetched, seal);
  for (const column of ["title", "location", "description", "calendar_name", "conference_url", "resource_url", "attendees"] as const) {
    assert.ok(isCiphertext(sealed[column]), column);
  }
  assert.equal(await decryptField(keys, FIELD.eventNotes, sealed.description!), "Bring the signed offer.");
  assert.equal(await decryptField(keys, FIELD.eventLink, sealed.conference_url!), fetched.conference_url);
  assert.equal(await decryptField(keys, FIELD.calendarName, sealed.calendar_name!), "Work");
  assert.equal(await decryptField(keys, FIELD.eventFile, sealed.resource_url!), fetched.resource_url);
  assert.deepEqual(JSON.parse(await decryptField(keys, FIELD.eventGuests, sealed.attendees as unknown as string)), fetched.attendees);
  // The times, ids and series stay readable: the database pages, matches and orders on them.
  assert.equal(sealed.starts_at, fetched.starts_at);
  assert.equal(sealed.provider_event_id, "e1");
});

test("a sealed event opens back to what was fetched, so the next sync writes nothing", async () => {
  const opened = await openEventText(await sealEventText(fetched, seal), open);
  assert.deepEqual(opened, fetched);
  assert.equal(eventChanged(opened, fetched), false);
});

test("an empty guest list stays a list, and sealing off stores the list as a list", async () => {
  assert.deepEqual((await sealEventText({ ...fetched, attendees: [] }, seal)).attendees, []);
  const plain = await sealEventText(fetched, plainSeal);
  assert.deepEqual(plain.attendees, fetched.attendees);
  assert.equal(plain.description, fetched.description);
});

test("a patch seals only the columns it has, and a value already sealed is not sealed twice", async () => {
  const patch = await sealEventText({ description: "New notes" }, seal);
  assert.deepEqual(Object.keys(patch), ["description"]);
  const again = await sealEventText(patch, seal);
  assert.equal(again.description, patch.description);
});

test("rows stored before sealing read as they are, and a guest list that will not open reads as none", async () => {
  assert.deepEqual(await openEventText(fetched, open), fetched);
  const broken = await openEventText({ attendees: "e1:AAAA" }, async () => "");
  assert.deepEqual(broken.attendees, []);
  assert.deepEqual(guestList("{\"not\":\"a list\"}"), []);
  assert.deepEqual(guestList("not json"), []);
});

const queued = { id: "q1", user_id: "u", title: "Lunch", description: null as string | null, location: "Café", attendees: ["thandi@example.com", "pieter@example.com"] };

test("a queued row opens its title, place and every guest", async () => {
  const sealed = {
    ...queued,
    title: await encryptField(keys, FIELD.eventTitle, "Lunch"),
    location: await encryptField(keys, FIELD.eventLocation, "Café"),
    attendees: [await encryptField(keys, FIELD.address, "thandi@example.com"), "pieter@example.com"],
  };
  const result = await openQueuedText(sealed, open);
  assert.ok("row" in result);
  assert.deepEqual(result.row, queued);
});

test("a queued guest that will not open fails the row instead of being dropped", async () => {
  const bad = { ...queued, attendees: [await encryptField(await deriveUserKeys(newDataKey()), FIELD.address, "thandi@example.com")] };
  assert.deepEqual(await openQueuedText(bad, open), { error: UNREADABLE });
});

test("a queued row opens strictly: a guest or title sealed for another row or column fails it", async () => {
  const bound = await deriveUserKeys(newDataKey(), "caabe3e9-0000-4000-8000-000000000001");
  const ROW = "caabe3e9-0000-4000-8000-0000000000e1";
  const at = (column: string, row = ROW) => ({ place: `calendar_outbox.${column}`, row });
  // The opener calendar/sealed.ts builds: the column of this row, encryption on, legacy values refused.
  const strict = (rowId: string) => (field: Field, value: string | null, column?: string) =>
    openExpected(bound, field, value, { places: [`calendar_outbox.${column}`], row: rowId, sealed: true, legacy: false });
  const row = { ...queued, title: await encryptAt(bound, FIELD.eventTitle, at("title"), "Lunch"), description: null, location: null, attendees: [await encryptAt(bound, FIELD.address, at("attendees"), "thandi@example.com")] };
  assert.ok("row" in (await openQueuedText(row, strict(ROW))));
  // An attacker's guest copied in from another queued row, or an address moved from a message, is refused.
  const other = await encryptAt(bound, FIELD.address, at("attendees", "caabe3e9-0000-4000-8000-0000000000e2"), "attacker@example.com");
  const fromMessage = await encryptAt(bound, FIELD.address, { place: "messages.sender_address" }, "attacker@example.com");
  for (const guest of [other, fromMessage, "attacker@example.com"]) {
    assert.deepEqual(await openQueuedText({ ...row, attendees: [guest] }, strict(ROW)), { error: UNREADABLE });
  }
  assert.deepEqual(await openQueuedText(row, strict("caabe3e9-0000-4000-8000-0000000000e2")), { error: UNREADABLE });
});

test("opened text is held to the limits the table used to check", async () => {
  const long = await encryptField(keys, FIELD.eventTitle, "x".repeat(MAX_TITLE + 1));
  assert.match((await openQueuedText({ ...queued, title: long }, open) as { error: string }).error, /300 characters/);
  const blank = await encryptField(keys, FIELD.eventTitle, "  ");
  assert.deepEqual(await openQueuedText({ ...queued, title: blank }, open), { error: "An event needs a title." });
  const ok = await openQueuedText({ ...queued, title: null, attendees: null }, open);
  assert.ok("row" in ok);
});
