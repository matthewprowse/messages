// Pure rules for which stored email an unsubscribe acts on, and whose request it is. No I/O, so it can be unit tested.
// unsubscribe-flow.ts reads the rows and calls these.

/** How many of a sender's latest emails with a List-Unsubscribe header are weighed. */
export const UNSUBSCRIBE_SOURCES = 10;

/** One stored email's unsubscribe header, with its provider_meta.auth verdicts (see ingest/email-auth.ts). */
export interface UnsubscribeSource {
  list_unsubscribe: string | null;
  list_unsubscribe_post: boolean | null;
  auth?: unknown;
}

/** True when the sender's own domain vouched for the email: DMARC or DKIM passed. */
export function isVouched(auth: unknown): boolean {
  if (!auth || typeof auth !== "object") return false;
  const a = auth as { dmarc?: unknown; dkim?: unknown };
  return a.dmarc === "pass" || a.dkim === "pass";
}

/**
 * The email whose List-Unsubscribe header is used, from a sender's latest ones (newest first): the newest that
 * passed DMARC or DKIM, else the newest. Anyone can put your sender's address in a From line, so a forged
 * email never outranks one the sender's domain signed. Null when there is none.
 */
export function pickUnsubscribeSource<T extends UnsubscribeSource>(newestFirst: T[]): T | null {
  return newestFirst.find((m) => isVouched(m.auth)) ?? newestFirst[0] ?? null;
}

/** Whether an unsubscribe request may run on this account: it names the account, and its person owns it. */
export function mayUnsubscribe(row: { account_id: string; user_id: string }, accountId: string, accountOwner: string | null): boolean {
  return row.account_id === accountId && accountOwner !== null && row.user_id === accountOwner;
}
