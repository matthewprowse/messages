// Seals what the app queues for the calendar worker, a calendar_outbox row for a new event or a calendar_updates row for
// a change: the title, location and notes under the event fields and each guest under the address field, so none of it
// is stored readable. The worker opens them and checks the guests are email addresses before anything reaches the
// calendar (apps/worker/src/calendar/event-text.ts). Each value is sealed for its column of this very row (the row's id is
// chosen in the app, queueSealers), so the worker acts only on text written for it. Pure: the seal functions come in as a
// parameter (the New Event dialog passes the vault's), so it is tested without keys.

import { FIELD, type Field } from "@messages/crypto/fields";

/** How text and addresses are sealed for a column of the row: lib/vault.ts seal and lib/address-refs.ts sealAddress, which follow their flags. */
export interface QueueSealers {
  text: (field: Field, value: string, column: string) => Promise<string>;
  address: (value: string, column: string) => Promise<string>;
}

type QueuedText = { title?: string | null; description?: string | null; location?: string | null; attendees?: string[] | null };

/**
 * The row with its text and guests sealed. A column left out or null stays so (in a change, "unchanged"); an empty
 * location or description is sealed too, as it means "clear it". Guests are sealed as they are: build them trimmed,
 * lowercase and without repeats first, as the database cannot do it once they are sealed.
 */
export async function sealQueuedEvent<T extends QueuedText>(row: T, sealers: QueueSealers): Promise<T> {
  const text = (field: Field, value: string | null | undefined, column: string) => (typeof value === "string" ? sealers.text(field, value, column) : value);
  const [title, description, location, attendees] = await Promise.all([
    text(FIELD.eventTitle, row.title, "title"),
    text(FIELD.eventNotes, row.description, "description"),
    text(FIELD.eventLocation, row.location, "location"),
    row.attendees ? Promise.all(row.attendees.map((a) => sealers.address(a, "attendees"))) : row.attendees,
  ]);
  const out: Record<string, unknown> = { ...row };
  if (row.title !== undefined) out.title = title;
  if (row.description !== undefined) out.description = description;
  if (row.location !== undefined) out.location = location;
  if (row.attendees !== undefined) out.attendees = attendees;
  return out as T;
}
