// A calendar event's title and location are encrypted (fields.ts eventTitle, eventLocation); the times, guests,
// notes and meeting link stay readable for now. Every write seals them with sealEvent and every read that uses
// them opens them with openEvent, so a row stored before encryption and one stored after read the same way.

import { FIELD } from "@messages/crypto/fields";
import { open, seal } from "../vault";

type Texts = { title?: string | null; location?: string | null };

/** The row with its title and location sealed (as the flag says). Fields left undefined stay undefined. */
export async function sealEvent<T extends Texts>(userId: string, row: T): Promise<T> {
  const out: T = { ...row };
  if (row.title !== undefined) out.title = await seal(userId, FIELD.eventTitle, row.title);
  if (row.location !== undefined) out.location = await seal(userId, FIELD.eventLocation, row.location);
  return out;
}

/** The row with its title and location opened. Plain values come back as they are. */
export async function openEvent<T extends Texts>(userId: string, row: T): Promise<T> {
  const out: T = { ...row };
  if (row.title != null) out.title = await open(userId, FIELD.eventTitle, row.title);
  if (row.location != null) out.location = await open(userId, FIELD.eventLocation, row.location);
  return out;
}
