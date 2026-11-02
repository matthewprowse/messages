// Small, pure edits to the store's contacts after a merge, a hide-free change of kind, or a delete, so the app
// patches what it holds instead of reading the whole contact graph again. Used by the reducer (reducer.ts).

import { isCompanySender } from "../people";
import type { Contact } from "../types";

/** What a person can change about a contact without a reload: hide them, or say whether they are a person or a company (null = the guess). */
export interface ContactPatch {
  hidden?: boolean;
  kindOverride?: "person" | "company" | null;
}

/** A change to a contact that the Contacts page applies to its lists, in order. */
export type ContactChange =
  | { kind: "merge"; keepId: string; mergeId: string; name?: string }
  | { kind: "patch"; id: string; patch: ContactPatch }
  | { kind: "remove"; id: string };

const union =(a: string[] | undefined, b: string[] | undefined) => {
  const out = [...new Set([...(a ?? []), ...(b ?? [])])];
  return out.length ? out : undefined;
};

/** Whether this contact writes as a company, worked out again from what they now have. */
export function withKind(c: Contact): Contact {
  return { ...c, isCompany: isCompanySender({ name: c.name, emails: c.emails, phones: c.phones, organizationName: c.organization?.name ?? null, kindOverride: c.kindOverride }) };
}

/**
 * The contacts after mergeId was merged into keepId: the kept contact gains the other's addresses, numbers and
 * handles, fills its blanks from the other (as the database does), and the merged one is gone. The kept contact
 * keeps its own name unless a name was chosen in the merge dialog.
 */
export function mergeContactInto(contacts: Contact[], keepId: string, mergeId: string, name?: string): Contact[] {
  const kept = contacts.find((c) => c.id === keepId);
  const gone = contacts.find((c) => c.id === mergeId);
  if (!gone) return contacts;
  const without = contacts.filter((c) => c.id !== mergeId);
  if (!kept) return without;
  const merged = withKind({
    ...kept,
    name: name || kept.name,
    emails: [...new Set([...kept.emails, ...gone.emails])],
    phones: [...new Set([...kept.phones, ...gone.phones])],
    handles: union(kept.handles, gone.handles),
    lids: union(kept.lids, gone.lids),
    company: kept.company ?? gone.company,
    role: kept.role ?? gone.role,
    avatarPath: kept.avatarPath ?? gone.avatarPath,
    organization: kept.organization ?? gone.organization,
    hasLinkedIn: kept.hasLinkedIn || gone.hasLinkedIn || undefined,
  });
  return without.map((c) => (c.id === keepId ? merged : c));
}

/** A list of contact ids with mergeId replaced by keepId, each once. */
export function repointIds(ids: string[], keepId: string, mergeId: string): string[] {
  if (!ids.includes(mergeId)) return ids;
  return [...new Set(ids.map((id) => (id === mergeId ? keepId : id)))];
}

/** The contacts with one changed; a change to who they are re-decides person or company. */
export function patchContactIn(contacts: Contact[], id: string, patch: Partial<Contact>): Contact[] {
  if (!contacts.some((c) => c.id === id)) return contacts;
  return contacts.map((c) => (c.id === id ? withKind({ ...c, ...patch }) : c));
}
