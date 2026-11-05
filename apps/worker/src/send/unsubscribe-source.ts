// Pure rules for which stored email an unsubscribe acts on, and whose request it is. No I/O, so it can be unit tested.
// unsubscribe-flow.ts reads the rows and calls these.

import { dkimAligned } from "../ingest/email-auth";

/** How many of a sender's latest emails with a List-Unsubscribe header are weighed. */
export const UNSUBSCRIBE_SOURCES = 10;

/** One stored email's unsubscribe header, with its provider_meta.auth verdicts (see ingest/email-auth.ts). */
export interface UnsubscribeSource {
  list_unsubscribe: string | null;
  list_unsubscribe_post: boolean | null;
  auth?: unknown;
}

/**
 * True when the sender's own domain vouched for the email: DMARC passed, or a DKIM signature passed and was made by
 * the From domain's own organisation (email-auth.ts dkimAligned). A DKIM pass by any other domain is just a signature:
 * a forger signs with their own domain and passes. Without the From domain only DMARC counts.
 */
export function isVouched(auth: unknown, fromDomain?: string | null): boolean {
  if (!auth || typeof auth !== "object") return false;
  const a = auth as { dmarc?: unknown; dkim?: unknown; dkim_domain?: unknown };
  return a.dmarc === "pass" || (a.dkim === "pass" && typeof a.dkim_domain === "string" && dkimAligned(a.dkim_domain, fromDomain));
}

/**
 * The email whose List-Unsubscribe header is used, from a sender's latest ones (newest first): the newest the
 * sender's domain vouched for (isVouched), else the newest. Anyone can put your sender's address in a From line, so
 * a forged email never outranks one the sender's domain signed. Null when there is none.
 */
export function pickUnsubscribeSource<T extends UnsubscribeSource>(newestFirst: T[], fromDomain?: string | null): T | null {
  return newestFirst.find((m) => isVouched(m.auth, fromDomain)) ?? newestFirst[0] ?? null;
}

/** Whether an unsubscribe request may run on this account: it names the account, and its person owns it. */
export function mayUnsubscribe(row: { account_id: string; user_id: string }, accountId: string, accountOwner: string | null): boolean {
  return row.account_id === accountId && accountOwner !== null && row.user_id === accountOwner;
}
