// Pure grouping for the Subscriptions view: conversations become one row per company (or per personal address), and a
// row's unsubscribe state is worked out from its addresses. The hook in components/thread-list/use-subscriptions.ts
// adds selection and the store.

import type { Contact, Thread, Unsubscribe } from "./types";

// Senders already unsubscribed, or on their way, cannot be picked again.
const UNPICKABLE = new Set<Unsubscribe["status"]>(["queued", "working", "done"]);

/** One address that sends subscriptions, on the account it sends to. Unsubscribing works one of these at a time. */
export interface Address {
  key: string;
  accountId: string;
  address: string;
}

/**
 * One row in Subscriptions: a company, with every address it writes from, as on the Companies tab. A sender
 * with no company (a personal address) is a row of its own.
 */
export interface Sender {
  key: string;
  name: string;
  addresses: Address[];
  /** The company, for its logo. */
  company?: { name: string; logoPath?: string };
  contact?: Contact;
  latest: Thread;
  count: number;
}

/** Whether an address can still be unsubscribed from. */
export const canPick = (status?: Unsubscribe) => !status || !UNPICKABLE.has(status.status);

/**
 * A row's state across its addresses: on its way while any is, waiting on you while any is left to confirm,
 * failed while any failed, and unsubscribed once all are. Nothing while some have never been asked.
 */
export function rowStatus(statuses: (Unsubscribe | undefined)[]): Unsubscribe | undefined {
  const known = statuses.filter((u): u is Unsubscribe => !!u);
  return known.find((u) => u.status === "queued" || u.status === "working")
    ?? known.find((u) => u.status === "manual")
    ?? known.find((u) => u.status === "failed")
    ?? (known.length === statuses.length ? known[0] : undefined);
}

/** Groups subscription conversations by company, newest sender first. Conversations with no account or address are skipped. */
export function groupSenders(items: Thread[], contactOf: (id: string) => Contact | undefined): Sender[] {
  const byKey = new Map<string, Sender>();
  for (const t of items) {
    const contact = t.isGroup ? undefined : contactOf(t.participantIds[0]);
    const address = contact?.emails[0];
    if (!t.accountId || !address) continue;
    const one = { key: `${t.accountId}:${address}`, accountId: t.accountId, address };
    const org = contact?.organization;
    const key = org ? `company:${org.id}` : one.key;
    const existing = byKey.get(key);
    if (existing) {
      existing.count++;
      if (!existing.addresses.some((a) => a.key === one.key)) existing.addresses.push(one);
      if (t.lastMessageAt > existing.latest.lastMessageAt) {
        existing.latest = t;
        existing.contact = contact;
      }
    } else {
      byKey.set(key, {
        key,
        name: org?.name ?? contact?.name ?? address,
        addresses: [one],
        company: org ? { name: org.name, logoPath: org.logoPath } : undefined,
        contact,
        latest: t,
        count: 1,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => b.latest.lastMessageAt.localeCompare(a.latest.lastMessageAt));
}
