// Where the app seals what it queues for the workers, so each value opens only in the row and column it was written for
// (packages/crypto/src/bound.ts and places.ts). The worker sends an outbox row, and makes a calendar or task change,
// only from values sealed for that very row: a body or an address copied in from elsewhere is refused there.

import type { Place } from "@messages/crypto";
import { outboxFileRow, storageWhere } from "@messages/crypto/places";

/** A column of an outbox row, bound to the row's id (chosen in the app before sealing). */
export const outboxPlace = (outboxId: string, column: string): Place => ({ place: `outbox.${column}`, row: outboxId });

/** An outbox file's name, bound to its outbox row and its storage path. */
export const outboxFileNamePlace = (outboxId: string, storagePath: string): Place => ({ place: "outbox_attachments.filename", row: outboxFileRow(outboxId, storagePath) });

/** Where an outbox file's bytes are stored, as they are sealed for it. */
export const outboxFileWhere = (storagePath: string) => storageWhere("attachments", storagePath);

/** A column of a queued calendar write (calendar_outbox, calendar_updates) or task write (task_updates), bound to its id. */
export const queuePlace = (table: "calendar_outbox" | "calendar_updates" | "task_updates", rowId: string, column: string): Place => ({ place: `${table}.${column}`, row: rowId });
