// What the setup dialog may honestly say Konva found, and what it may save. Everything here comes from what the
// store already holds (conversations, contacts, accounts) or from what the person typed; nothing is invented.
// Kept as plain functions so the rule "never save a made-up profile" can be tested.

import type { Account, Contact, Thread } from "./types";

export type Role = "estate_agent" | "broker" | "attorney" | "recruiter" | "other";

export const ROLES: { value: Role; label: string }[] = [
  { value: "estate_agent", label: "Estate Agent" },
  { value: "broker", label: "Broker or Adviser" },
  { value: "attorney", label: "Attorney" },
  { value: "recruiter", label: "Recruiter" },
  { value: "other", label: "Something Else" },
];

const PHRASE: Record<Exclude<Role, "other">, string> = {
  estate_agent: "an estate agent",
  broker: "a broker or adviser",
  attorney: "an attorney",
  recruiter: "a recruiter",
};

export interface Person {
  name: string;
  why: string;
}

export interface FoundCounts {
  conversations: number;
  emailConversations: number;
  whatsappConversations: number;
  contacts: number;
}

/** Counts of what has really arrived so far, from the loaded conversations and contacts. */
export function foundCounts(threads: Pick<Thread, "channel">[], contactCount: number): FoundCounts {
  const emailConversations = threads.filter((t) => t.channel === "email").length;
  const whatsappConversations = threads.filter((t) => t.channel === "whatsapp").length;
  return { conversations: threads.length, emailConversations, whatsappConversations, contacts: contactCount };
}

const MAIL = ["gmail", "icloud", "outlook", "imap"];

/** The first import is over when no mail or WhatsApp account is still connecting or syncing. */
export function importSettled(accounts: Pick<Account, "provider" | "status">[]): boolean {
  return !accounts.some((a) => (MAIL.includes(a.provider) || a.provider === "whatsapp") && (a.status === "connecting" || a.status === "syncing"));
}

/** A starting point for About You, only from what the person said: their role and anything they added. Empty when they said nothing. */
export function aboutSeed(role: Role | "", extra: string): string {
  const parts: string[] = [];
  if (role && role !== "other") parts.push(`You're ${PHRASE[role]}.`);
  const t = extra.trim().replace(/\s+/g, " ");
  if (t) parts.push(/[.!?]$/.test(t) ? t : `${t}.`);
  return parts.join(" ");
}

/** The people you have the most one to one conversations with, by name. Real data, so it is safe to offer; the person can still remove any. */
export function topPeople(threads: Pick<Thread, "participantIds" | "isGroup">[], contacts: Pick<Contact, "id" | "name" | "isCompany">[], limit = 4): Person[] {
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const n = new Map<string, number>();
  for (const t of threads) {
    if (t.isGroup) continue;
    for (const id of t.participantIds) n.set(id, (n.get(id) ?? 0) + 1);
  }
  return [...n.entries()]
    .map(([id, count]) => ({ c: byId.get(id), count }))
    .filter((x): x is { c: Pick<Contact, "id" | "name" | "isCompany">; count: number } => !!x.c && !!x.c.name.trim() && !x.c.isCompany)
    .sort((a, b) => b.count - a.count || a.c.name.localeCompare(b.c.name))
    .slice(0, limit)
    .map(({ c, count }) => ({ name: c.name.trim(), why: `${count} ${count === 1 ? "conversation" : "conversations"}` }));
}

/** The people list as the Important People setting stores it, one per line. */
export function peopleText(people: Person[]): string {
  return people.map((p) => (p.why ? `${p.name}: ${p.why}` : p.name)).join("\n");
}

/** What "Looks Right" writes: only fields the person has not filled in themselves, only from what they kept. */
export function keepPatch(profile: { about: string; people: string }, about: string, people: Person[]): { about?: string; people?: string } {
  return {
    ...(!profile.about.trim() && about.trim() ? { about: about.trim() } : {}),
    ...(!profile.people.trim() && people.length ? { people: peopleText(people) } : {}),
  };
}
