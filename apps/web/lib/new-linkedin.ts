import type { Contact, Thread } from "./types";

// Pure helpers for starting a LinkedIn conversation from the New menu: who it can be to. The worker finds the
// person, sends the message through the LinkedIn helper and links the new conversation to the outbox row.

const PROFILE_URN = /^urn:li:fsd_profile:[A-Za-z0-9_-]+$/;
export const LINKEDIN_HINT = "Paste the link to their LinkedIn profile, like linkedin.com/in/jane-doe, or choose someone you already message.";

/** The linked LinkedIn accounts that can send. */
export function linkedinAccounts<T extends { provider: string; status: string }>(accounts: T[]): T[] {
  return accounts.filter((a) => a.provider === "linkedin" && (a.status === "connected" || a.status === "syncing"));
}

/**
 * A profile link or URN as the worker takes it, or null when it names nobody. Any linkedin.com/in/ link works,
 * with or without https, a country subdomain, a trailing slash or a tracking query.
 */
export function parseLinkedInProfile(input: string): string | null {
  const raw = input.trim();
  if (PROFILE_URN.test(raw)) return raw;
  if (!/linkedin\.com\//i.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.hostname !== "linkedin.com" && !url.hostname.endsWith(".linkedin.com")) return null;
  const [kind, slug] = url.pathname.split("/").filter(Boolean);
  if (kind !== "in" || !slug) return null;
  return `https://www.linkedin.com/in/${slug}`;
}

/** The LinkedIn profile URN a contact was seen with. It is kept among their numbers, as any non-email identity is. */
export function linkedinUrnOf(contact: Pick<Contact, "phones">): string | undefined {
  return contact.phones.find((p) => PROFILE_URN.test(p));
}

/** Contacts with a LinkedIn profile whose name has every word typed. */
export function searchLinkedInContacts<T extends Pick<Contact, "id" | "name" | "phones">>(contacts: T[], query: string, limit = 6): { contact: T; urn: string }[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const out: { contact: T; urn: string }[] = [];
  for (const contact of contacts) {
    const urn = linkedinUrnOf(contact);
    if (!urn) continue;
    const name = contact.name.toLowerCase();
    if (words.every((w) => name.includes(w))) out.push({ contact, urn });
    if (out.length >= limit) break;
  }
  return out;
}

/** The newest one-to-one LinkedIn conversation with this contact on this account, so a first message becomes a reply. */
export function existingLinkedInChat<T extends Pick<Thread, "id" | "channel" | "isGroup" | "lastMessageAt" | "accountId" | "participantIds">>(
  threads: T[], contactId: string, accountId?: string,
): T | undefined {
  let best: T | undefined;
  for (const t of threads) {
    if (t.channel !== "linkedin" || t.isGroup || !t.participantIds.includes(contactId)) continue;
    if (accountId && t.accountId && t.accountId !== accountId) continue;
    if (!best || t.lastMessageAt > best.lastMessageAt) best = t;
  }
  return best;
}
