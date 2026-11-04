// Which calendar text is sealed, and how a calendar_events row and a queued calendar_outbox or calendar_updates row are
// sealed and opened. Pure: the seal and open functions come in as parameters (calendar/sealed.ts passes the vault's),
// so this is tested without keys or a database.
//
// An event's title, location, notes, calendar name, join link and iCloud file are each sealed under their own field. Its
// guests are one value: the whole list as JSON, sealed under eventGuests and stored in the jsonb column as a string. An
// empty list stays [] (it says nothing a sealed one's length would not). The browser seals a queued row's title,
// location and notes the same way and each guest under the address field; the database can no longer check them, so
// openQueuedText checks the opened text against the limits the table used to hold.

import { isCiphertext } from "@messages/crypto";
import { FIELD, type Field } from "@messages/crypto/fields";
import type { Json } from "@messages/db";

/** Seals one value under `field` for `column`, or hands it back as it is when sealing is off. null stays null. */
export type SealText = (field: Field, value: string | null, column?: string) => Promise<string | null>;
/** Opens one stored value; plain text and null come back as they are. A queued row's opener is also told the column. */
export type OpenText = (field: Field, value: string | null, column?: string) => Promise<string | null>;

/** The text columns of calendar_events and the field each is sealed under. attendees is apart: see the header. */
export const EVENT_TEXT: readonly (readonly [column: string, field: Field])[] = [
  ["title", FIELD.eventTitle],
  ["location", FIELD.eventLocation],
  ["description", FIELD.eventNotes],
  ["calendar_name", FIELD.calendarName],
  ["conference_url", FIELD.eventLink],
  ["resource_url", FIELD.eventFile],
];

type EventText = {
  title?: string | null;
  location?: string | null;
  description?: string | null;
  calendar_name?: string | null;
  conference_url?: string | null;
  resource_url?: string | null;
  attendees?: Json;
};

/** The row with its text and guests sealed (as the seal function says). Columns left undefined stay undefined. */
export async function sealEventText<T extends EventText>(row: T, seal: SealText): Promise<T> {
  const out: Record<string, unknown> = { ...row };
  for (const [column, field] of EVENT_TEXT) {
    const value = (row as Record<string, unknown>)[column];
    if (value !== undefined && !isCiphertext(value)) out[column] = await seal(field, value as string | null, column);
  }
  if (Array.isArray(row.attendees) && row.attendees.length > 0) {
    const sealed = await seal(FIELD.eventGuests, JSON.stringify(row.attendees), "attendees");
    // With sealing off the seal function hands the JSON text back, and the list is stored as a list.
    if (isCiphertext(sealed)) out.attendees = sealed;
  }
  return out as T;
}

/** The row with its text and guests opened. Plain values come back as they are; a guest list that will not open is empty. */
export async function openEventText<T extends EventText>(row: T, open: OpenText): Promise<T> {
  const out: Record<string, unknown> = { ...row };
  for (const [column, field] of EVENT_TEXT) {
    const value = (row as Record<string, unknown>)[column];
    if (typeof value === "string") out[column] = await open(field, value);
  }
  if (isCiphertext(row.attendees)) out.attendees = guestList(await open(FIELD.eventGuests, row.attendees));
  return out as T;
}

/** An opened guest list: the JSON array, or [] for anything else. */
export function guestList(text: string | null): Json {
  if (!text) return [];
  try {
    const list: unknown = JSON.parse(text);
    return Array.isArray(list) ? (list as Json) : [];
  } catch {
    return [];
  }
}

// The limits calendar_outbox and calendar_updates held while their text was readable (20261023300000, 20261028110500).
export const MAX_TITLE = 300;
export const MAX_NOTES = 8000;
export const MAX_LOCATION = 500;
export const UNREADABLE = "This event could not be read. Try again.";

type QueuedText = { title: string | null; description: string | null; location: string | null; attendees: string[] | null };

const length = (text: string) => [...text].length; // characters, as Postgres counts them

/**
 * A queued row with what the app sealed opened: title, location and notes under the event fields, each guest under the
 * address field, each for its column (the opener checks it was sealed for that column of this row). `open` must throw on
 * a value it cannot open or that was sealed elsewhere, so a guest is never dropped or added without a word. The text is
 * checked against the limits the table held; guests are checked by the code that builds the request (cleanAttendees).
 */
export async function openQueuedText<T extends QueuedText>(row: T, open: OpenText): Promise<{ row: T } | { error: string }> {
  let opened: T;
  try {
    const [title, description, location, attendees] = await Promise.all([
      open(FIELD.eventTitle, row.title, "title"),
      open(FIELD.eventNotes, row.description, "description"),
      open(FIELD.eventLocation, row.location, "location"),
      row.attendees === null ? null : Promise.all(row.attendees.map(async (a) => (await open(FIELD.address, a, "attendees")) ?? "")),
    ]);
    opened = { ...row, title, description, location, attendees };
  } catch {
    return { error: UNREADABLE };
  }
  if (opened.title !== null && (!opened.title.trim() || length(opened.title) > MAX_TITLE)) {
    return { error: opened.title.trim() ? `Keep the title to ${MAX_TITLE} characters or fewer.` : "An event needs a title." };
  }
  if (opened.description !== null && length(opened.description) > MAX_NOTES) return { error: `Keep the description to ${MAX_NOTES} characters or fewer.` };
  if (opened.location !== null && length(opened.location) > MAX_LOCATION) return { error: `Keep the location to ${MAX_LOCATION} characters or fewer.` };
  return { row: opened };
}
