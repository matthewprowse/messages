// The Contacts lists built from the contacts the app store already holds, so opening Contacts reads only the
// small parts the store lacks (which are hidden, who has WhatsApp, the activity counts) and not every address again.

import type { ContactSummary } from "./contacts";
import type { Contact } from "./types";

export type Activity = { contact_id: string; last_at: string | null; conversation_count: number };

/** The list rows for these contacts. Pure: the caller passes what the small queries returned. */
export function summariseStored(
  rows: { id: string; hidden: boolean }[],
  stored: Map<string, Contact>,
  activity: Map<string, Activity>,
  whatsapp: Set<string>,
  linkedin: Set<string> = new Set(),
): ContactSummary[] | null {
  const out: ContactSummary[] = [];
  for (const row of rows) {
    const c = stored.get(row.id);
    if (!c) return null; // a contact the store has not seen: the caller reads everything instead
    const a = activity.get(row.id);
    out.push({
      id: c.id,
      name: c.name,
      company: c.organization?.name ?? c.company ?? null,
      role: c.role ?? null,
      hidden: row.hidden,
      emails: [...new Set(c.emails)],
      phones: [...new Set(c.phones)],
      hasWhatsApp: whatsapp.has(row.id),
      handles: c.handles ?? [],
      hasLinkedIn: linkedin.has(row.id) || !!c.hasLinkedIn,
      kindOverride: c.kindOverride,
      lastAt: a?.last_at ?? null,
      avatarPath: c.avatarPath,
      isCompany: c.isCompany,
      organizationName: c.organization?.name ?? null,
      conversationCount: a?.conversation_count ?? 0,
    });
  }
  return out;
}
