// When a queued outbox row may be sent. The app sets send_after for Undo Send (a few seconds) and Send Later (any time);
// the worker claims only rows that are due, so it cannot send early. Pure: the claim and the dispatcher call it.

/** A PostgREST `or` filter for rows that are due: no send_after, or one that has passed. */
export function dueFilter(now = Date.now()): string {
  return `send_after.is.null,send_after.lte.${new Date(now).toISOString()}`;
}

/** Whether a row may be sent now. A missing or unreadable time counts as due, so a bad value never strands a message. */
export function isDue(sendAfter: string | null | undefined, now = Date.now()): boolean {
  if (!sendAfter) return true;
  const at = Date.parse(sendAfter);
  return !Number.isFinite(at) || at <= now;
}

/** Milliseconds until a row is due (0 when it already is). */
export function msUntilDue(sendAfter: string | null | undefined, now = Date.now()): number {
  return isDue(sendAfter, now) ? 0 : Date.parse(sendAfter as string) - now;
}

/**
 * The time a row's wait for a broken account counts from: when it became due, not when it was written, so a message
 * scheduled for tomorrow is not judged as a day old the moment it is due.
 */
export function waitingSince(row: { created_at: string; send_after?: string | null }): string {
  return row.send_after && Number.isFinite(Date.parse(row.send_after)) && row.send_after > row.created_at ? row.send_after : row.created_at;
}
