// Which stored Inbox messages are gone from the server. Pure: the IMAP search that says which UIDs are still present
// is done by imap/reconcile-inbox.ts. UIDs only mean something within one UIDVALIDITY.

type Row = { provider_meta: unknown };

const validityOf = (r: Row) => (r.provider_meta as { uid_validity?: number } | null)?.uid_validity;
const uidOf = (r: Row) => (r.provider_meta as { uid?: number }).uid;

/**
 * Rows stored under the folder's current UIDVALIDITY, and their UIDs. Rows from an older UIDVALIDITY are not current:
 * their UIDs now point at other messages, if any.
 */
export function currentRows<R extends Row>(rows: R[], uidValidity: number): { current: Set<R>; uids: number[] } {
  const current = new Set(rows.filter((r) => validityOf(r) === uidValidity));
  return { current, uids: [...current].map((r) => (r.provider_meta as { uid: number }).uid) };
}

/** Rows no longer in the Inbox: not current, or current but absent from the server. Rows with no recorded UIDVALIDITY are unknown, not gone. */
export function goneRows<R extends Row>(rows: R[], current: Set<R>, present: Set<number>): R[] {
  return rows.filter((r) => validityOf(r) !== undefined && (!current.has(r) || !present.has(uidOf(r) ?? -1)));
}
