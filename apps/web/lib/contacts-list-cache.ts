// What the Contacts layout last showed (contacts, companies, merge suggestions), kept in memory per person so leaving
// /contacts and coming back shows the lists at once and reads them again underneath only when old. Names and addresses
// are decrypted here, so memory only, emptied on sign out (lib/memory-cache.ts). Pure: the layout does the reading.

import type { ContactSummary } from "./contacts";
import type { CompanySummary } from "./organizations";
import type { MergeSuggestion } from "./contact-merging";
import { createMemoryCache } from "./memory-cache";

/** How long a kept list is trusted on a return before it is read again underneath. */
export const CONTACTS_FRESH_MS = 2 * 60_000;

export type ContactList = "contacts" | "companies" | "suggestions";

export interface ContactsSnapshot {
  contacts?: ContactSummary[];
  companies?: CompanySummary[];
  suggestions?: MergeSuggestion[];
  suggestionsMore: number;
  /** When each list was last read, in ms; 0 for never. */
  at: Record<ContactList, number>;
  /** How many of the store's contactChanges the lists include, and the store's contactsRefreshed they were read at. */
  seen: number;
  refreshed: number;
}

const snapshots = createMemoryCache<ContactsSnapshot>({ max: 1 });
const EMPTY: ContactsSnapshot = { suggestionsMore: 0, at: { contacts: 0, companies: 0, suggestions: 0 }, seen: 0, refreshed: 0 };

/** The lists as last shown to this person, or undefined. */
export function contactsSnapshot(userId: string | undefined): ContactsSnapshot | undefined {
  return userId ? snapshots.get(userId) : undefined;
}

/** Merges a change into the person's kept lists, starting them when there are none. */
export function saveContactsSnapshot(userId: string, patch: Partial<Omit<ContactsSnapshot, "at">> & { at?: Partial<ContactsSnapshot["at"]> }) {
  const held = snapshots.get(userId) ?? EMPTY;
  snapshots.set(userId, { ...held, ...patch, at: { ...held.at, ...patch.at } });
}

/**
 * Whether a list shown from memory may skip its read: it was read within CONTACTS_FRESH_MS, the store has not read the
 * whole contact graph again since, and the store still holds every change the list has seen (it was not started over).
 */
export function isListFresh(snap: ContactsSnapshot | undefined, list: ContactList, store: { refreshed: number; changes: number }, now: number): boolean {
  if (!snap || snap[list] === undefined) return false;
  if (snap.refreshed !== store.refreshed || snap.seen > store.changes) return false;
  return now - snap.at[list] < CONTACTS_FRESH_MS;
}

/** Where to start applying the store's contactChanges: after those the kept lists include, or from now when there are none. */
export function changesSeen(snap: ContactsSnapshot | undefined, changes: number): number {
  return snap && snap.seen <= changes ? snap.seen : changes;
}
