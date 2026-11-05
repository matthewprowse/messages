// Extra made-up data for the contacts, notes and compose screen tests: Contacts list summaries built from the shared
// fixture people, and a note.

import type { ContactSummary } from "@/lib/contacts";
import type { Note } from "@/lib/notes";
import { AVA, BEN, CHLOE, DANIEL, minutesAgo } from "./fixtures";

/** A Contacts list summary for one of the fixture people, read and starred as the test says. */
export function summary(c: { id: string; name: string; emails: string[]; phones: string[]; company?: string }, extra: Partial<ContactSummary> = {}): ContactSummary {
  return {
    id: c.id, name: c.name, company: c.company ?? null, role: null, emails: c.emails, phones: c.phones, lastAt: minutesAgo(60), isCompany: false,
    organizationName: null, conversationCount: 1, hasWhatsApp: false, handles: [], hasLinkedIn: false, hidden: false, ...extra,
  };
}

export const SUMMARIES: ContactSummary[] = [
  summary(AVA, { vip: true, relationship: "Client", lastAt: minutesAgo(30) }),
  summary(BEN, { relationship: "Supplier", lastAt: minutesAgo(120) }),
  summary(CHLOE, { lastAt: minutesAgo(600) }),
  summary(DANIEL, { lastAt: minutesAgo(2000) }),
];

/** A note in the list, its text downloaded. */
export function note(id: string, extra: Partial<Note> = {}): Note {
  return { id, title: "Site Visit Checklist", body: "Measure the kitchen walls before Thursday.", excerpt: null, pinned: false, useInDrafts: false, createdAt: minutesAgo(3000), updatedAt: minutesAgo(45), ...extra };
}

