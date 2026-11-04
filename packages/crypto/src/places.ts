// How writers and strict readers name the place of a value in the columns that drive an action (bound.ts), so the web
// app that seals an outbox row and the worker that sends it agree byte for byte, and the re-seal job binds legacy values
// the same way. apps/ai/ai/places.py has the same rules for the AI worker's side (Instagram sends, iCloud Reminders).
//
// Each of these rows is bound to its own id, which the app chooses before it seals (an outbox id, a calendar or task
// write's id), except an outbox file's name: it is bound to its outbox row and its storage path together, so a name, a
// file and a row cannot be recombined. A file's bytes are bound to their bucket and path.

/** The tables whose sealed values are bound to a row, and how a row names itself. */
export const ROW_BOUND_TABLES = ["outbox", "outbox_attachments", "calendar_outbox", "calendar_updates", "task_updates", "drafts"] as const;

/** "<table>.<column>". */
export const placeOfColumn = (table: string, column: string) => `${table}.${column}`;

/** The row an outbox file's name is bound to: its outbox row and its storage path. */
export const outboxFileRow = (outboxId: string, storagePath: string) => `${outboxId}:${storagePath}`;

/** Where a stored object is, as a sealed file's bytes are bound to it. */
export const storageWhere = (bucket: string, path: string) => `${bucket}/${path}`;

/**
 * The row a value in this table and column is bound to, from the row's own columns (and its primary key): a string,
 * null when the row cannot say (a column it needs is missing), or undefined when the table binds no row.
 */
export function boundRowOf(table: string, row: Record<string, unknown>): string | null | undefined {
  if (!(ROW_BOUND_TABLES as readonly string[]).includes(table)) return undefined;
  if (table === "outbox_attachments") {
    return typeof row.outbox_id === "string" && typeof row.storage_path === "string" ? outboxFileRow(row.outbox_id, row.storage_path) : null;
  }
  return typeof row.id === "string" ? row.id : null;
}
