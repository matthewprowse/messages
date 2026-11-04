// A calendar event's text is sealed per user: title, location, notes, calendar name, join link, iCloud file and the guest
// list (event-text.ts says how). Every write seals with sealEvent and every read that uses them opens with openEvent, so a
// row stored before sealing and one stored after read the same way. openQueued opens what the app sealed in a queued
// calendar_outbox or calendar_updates row before a connector reads it, strictly: each value must have been sealed for its
// column of that very row (vault.ts openBound), so nothing copied in from elsewhere reaches the calendar.

import { FIELD, type Field } from "@messages/crypto/fields";
import { open, openBound, seal } from "../vault";
import { openEventText, openQueuedText, sealEventText } from "./event-text";

type Texts = Parameters<typeof sealEventText>[0];

/** The row with its text and guests sealed (as ENCRYPT_CONTENT says), each for its calendar_events column. Columns left undefined stay undefined. */
export function sealEvent<T extends Texts>(userId: string, row: T): Promise<T> {
  return sealEventText(row, (field: Field, value, column) => seal(userId, field, value, column ? { place: `calendar_events.${column}` } : undefined));
}

/** The row with its text and guests opened. Plain values come back as they are. */
export function openEvent<T extends Texts>(userId: string, row: T): Promise<T> {
  return openEventText(row, (field: Field, value) => open(userId, field, value));
}

type Queued = { id: string; user_id: string; title: string | null; description: string | null; location: string | null; attendees: string[] | null };

/** A queued row of `table` (its own user's) opened and checked, or the reason it cannot be used, to fail it with. */
export function openQueuedIn(table: "calendar_outbox" | "calendar_updates") {
  return <T extends Queued>(row: T): Promise<{ row: T } | { error: string }> =>
    openQueuedText(row, (field: Field, value, column) =>
      openBound(row.user_id, field, value, { places: [`${table}.${column}`], row: row.id }, field === FIELD.address ? "address" : "content"));
}
