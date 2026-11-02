// Edits to the Contacts page's lists after a merge, a hide, a change of kind or a delete, so the page patches what it
// shows instead of loading every list again. Pure; used by app/contacts/layout.tsx.

import type { ContactSummary } from "./contacts";
import type { MergeSuggestion } from "./contact-merging";
import type { CompanySummary } from "./organizations";
import { isCompanySender } from "./people";
import { repointIds } from "./app-store/contact-patch";

const newest = (a: string | null, b: string | null) => (a && b ? (a > b ? a : b) : a ?? b);

/** Whether this summary is a company sender, worked out again from what it now has. */
export function withSummaryKind(c: ContactSummary): ContactSummary {
  return { ...c, isCompany: isCompanySender(c) };
}

/** The list with one row changed. */
export function patchSummary(list: ContactSummary[], id: string, patch: Partial<ContactSummary>): ContactSummary[] {
  if (!list.some((c) => c.id === id)) return list;
  return list.map((c) => (c.id === id ? withSummaryKind({ ...c, ...patch }) : c));
}

/**
 * The list after mergeId was merged into keepId. The kept row gains the other's addresses and numbers, the newest
 * activity and (as an upper bound, since a shared conversation is counted twice) both conversation counts; the other
 * row goes. The next full read corrects the count.
 */
export function mergeSummaries(list: ContactSummary[], keepId: string, mergeId: string, name?: string): ContactSummary[] {
  const kept = list.find((c) => c.id === keepId);
  const gone = list.find((c) => c.id === mergeId);
  if (!gone) return list;
  const rest = list.filter((c) => c.id !== mergeId);
  if (!kept) return rest;
  const merged = withSummaryKind({
    ...kept,
    name: name || kept.name,
    emails: [...new Set([...kept.emails, ...gone.emails])],
    phones: [...new Set([...kept.phones, ...gone.phones])],
    handles: [...new Set([...kept.handles, ...gone.handles])],
    hasWhatsApp: kept.hasWhatsApp || gone.hasWhatsApp,
    hasLinkedIn: kept.hasLinkedIn || gone.hasLinkedIn,
    lastAt: newest(kept.lastAt, gone.lastAt),
    conversationCount: kept.conversationCount + gone.conversationCount,
    company: kept.company ?? gone.company,
    role: kept.role ?? gone.role,
    avatarPath: kept.avatarPath ?? gone.avatarPath,
    organizationName: kept.organizationName ?? gone.organizationName,
  });
  return rest.map((c) => (c.id === keepId ? merged : c));
}

/** Suggestions after a merge: pairs that are now one person go, and the merged one's other pairs point at the kept one once. */
export function mergeSuggestions(list: MergeSuggestion[], keepId: string, mergeId: string): MergeSuggestion[] {
  const seen = new Set<string>();
  const out: MergeSuggestion[] = [];
  for (const s of list) {
    const [a, b] = repointIds([s.contactA, s.contactB], keepId, mergeId);
    if (!b) continue; // both sides became the same person
    const key = [a, b].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a === s.contactA && b === s.contactB ? s : { ...s, contactA: a, contactB: b });
  }
  return out;
}

/** Companies after a person was merged away: their company has one person fewer, and goes when it has none. */
export function mergeCompanies(list: CompanySummary[], gone: Pick<ContactSummary, "organizationName"> | undefined): CompanySummary[] {
  if (!gone?.organizationName) return list;
  const name = gone.organizationName;
  return list.flatMap((c) => (c.name !== name ? [c] : c.people <= 1 ? [] : [{ ...c, people: c.people - 1 }]));
}

/** The list without one contact, after they are deleted. */
export function removeSummary(list: ContactSummary[], id: string): ContactSummary[] {
  return list.some((c) => c.id === id) ? list.filter((c) => c.id !== id) : list;
}
