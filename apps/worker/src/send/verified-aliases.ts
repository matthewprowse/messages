// The send addresses a mail provider itself vouched for, per account, as the connector read them from the provider at
// connect (Gmail's "Send mail as" list, an Outlook account's own address). In memory only: accounts.send_addresses is
// also written by the app for iCloud (apps/web/lib/app-store/use-outbox.ts), so a changed client could put any address
// there; a Gmail or Outlook send checks the From against this list, never the column (security audit 2026-11-04).
// The sync worker that connects an account is the one that sends for it (accounts are sharded), so the list is here
// whenever a send can happen; before the connector has connected, only the account's own address may be used.

const verified = new Map<string, readonly string[]>();

/** Records the provider's own list for an account, lowercase. Replaces what was known. */
export function rememberSendable(accountId: string, addresses: readonly string[]): void {
  verified.set(accountId, [...new Set(addresses.map((a) => a.trim().toLowerCase()).filter(Boolean))]);
}

/** The provider's list for an account, or null when this process has not connected it yet. */
export function verifiedSendable(accountId: string): readonly string[] | null {
  return verified.get(accountId) ?? null;
}

/** Forgets an account's list, for a disconnect or removal. */
export function forgetSendable(accountId: string): void {
  verified.delete(accountId);
}
