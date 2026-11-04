// A contact's page as last loaded, kept in memory per contact so going back to someone shows them at once, and the page
// drawn from what the app already holds (the Contacts list and the store) while the first full read is on its way.
// Names and addresses are decrypted here: memory only, emptied on sign out (lib/memory-cache.ts). Pure: the page reads.

import type { ContactConversation, ContactDetail, ContactSummary } from "./contacts";
import type { Contact, Thread } from "./types";
import { createMemoryCache } from "./memory-cache";

/** How long a kept page is trusted on a return before it is read again underneath. */
export const CONTACT_FRESH_MS = 60_000;

/** A kept page, with the store's contactsVersion and number of contactChanges it was read at. */
export interface CachedContact {
  detail: ContactDetail;
  version: number;
  changes: number;
}

const details = createMemoryCache<CachedContact>({ max: 30 });
const keyOf = (userId: string, id: string) => `${userId}|${id}`;

/** The page kept for this contact, or undefined. */
export function cachedContact(userId: string | undefined, id: string): CachedContact | undefined {
  return userId ? details.get(keyOf(userId, id)) : undefined;
}

/** Keeps a page just read. */
export function cacheContact(userId: string, id: string, entry: CachedContact) {
  details.set(keyOf(userId, id), entry);
}

/** Forgets a contact's page (not found any more). */
export function forgetContact(userId: string, id: string) {
  details.delete(keyOf(userId, id));
}

/** Applies a change made elsewhere (a star from the list) to a kept page, so a return shows it. */
export function patchCachedContact(userId: string, id: string, patch: Partial<ContactSummary>) {
  details.patch(keyOf(userId, id), (e) => ({ ...e, detail: { ...e.detail, ...patch } }));
}

/** Whether a kept page may skip its read: young, and no merge, split, edit or other contact change since. */
export function isContactFresh(userId: string, id: string, store: { version: number; changes: number }): boolean {
  const entry = cachedContact(userId, id);
  if (!entry || entry.version !== store.version || entry.changes !== store.changes) return false;
  return details.age(keyOf(userId, id)) < CONTACT_FRESH_MS;
}

const CHANNEL_NAMES: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", linkedin: "LinkedIn", teams: "Teams", zoom: "Zoom", google_chat: "Google Chat" };

/** The store's conversations with this contact, as the page lists them: newest first, deleted ones left out. */
export function storedConversations(id: string, threads: Thread[]): ContactConversation[] {
  return threads
    .filter((t) => t.status !== "trash" && t.participantIds.includes(id))
    .map((t) => ({
      id: t.id,
      channel: t.channel as ContactConversation["channel"],
      provider: t.provider,
      isGroup: !!t.isGroup,
      title: (t.isGroup ? t.groupName : t.subject) ?? (t.channel === "email" ? "No Subject" : CHANNEL_NAMES[t.channel] ?? "Conversation"),
      preview: t.preview ?? null,
      lastAt: t.lastMessageAt,
    }))
    .sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
}

/**
 * A first draw of the page from what is already held: the Contacts list's row (numbers, star, relationship) or else the
 * store's contact, and the store's conversations. Marked partial: no files, notes, summary or address ids yet, so the
 * page holds back what needs them. Null when neither knows the contact.
 */
export function provisionalContact(id: string, listed: ContactSummary | undefined, stored: Contact | undefined, threads: Thread[]): ContactDetail | null {
  if (!listed && !stored) return null;
  const conversations = storedConversations(id, threads);
  const organization = stored?.organization ? { id: stored.organization.id, name: stored.organization.name } : null;
  const base: ContactSummary = listed ?? {
    id,
    name: stored!.name,
    company: stored!.organization?.name ?? stored!.company ?? null,
    role: stored!.role ?? null,
    emails: stored!.emails,
    phones: stored!.phones,
    handles: stored!.handles ?? [],
    lastAt: conversations[0]?.lastAt ?? null,
    avatarPath: stored!.avatarPath,
    isCompany: stored!.isCompany,
    organizationName: stored!.organization?.name ?? null,
    conversationCount: conversations.length,
    hasWhatsApp: conversations.some((c) => c.channel === "whatsapp"),
    hasLinkedIn: !!stored!.hasLinkedIn,
    kindOverride: stored!.kindOverride,
    hidden: false,
  };
  return {
    ...base,
    relationship: base.relationship ?? null,
    leadSource: null,
    summary: null,
    aboutNote: null,
    organization,
    conversations,
    attachments: [],
    identityRows: [],
    partial: true,
  };
}
