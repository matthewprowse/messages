// Puts what the relationship layer knows (star, relationship, last message each way) onto the Contacts list rows.
// Pure: contact-relations-io.ts reads the rows, and the Contacts layout applies them to whichever list it loaded.

import type { ContactSummary } from "./contacts";

/** One contact's relationship facts. */
export interface Relation {
  vip: boolean;
  relationship: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
}

export const NO_RELATION: Relation = { vip: false, relationship: null, lastInboundAt: null, lastOutboundAt: null };

/** The rows with their relation added. A contact with nothing recorded gets the empty one, so every row has the fields. */
export function applyRelations(rows: ContactSummary[], relations: Map<string, Relation>): ContactSummary[] {
  return rows.map((c) => ({ ...c, ...(relations.get(c.id) ?? NO_RELATION) }));
}

/** Joins the three reads into one map: starred or related contacts, and the last message each way. */
export function joinRelations(
  flags: { id: string; vip: boolean; relationship: string | null }[],
  touches: { contact_id: string; last_inbound_at: string | null; last_outbound_at: string | null }[],
): Map<string, Relation> {
  const out = new Map<string, Relation>();
  for (const f of flags) out.set(f.id, { ...NO_RELATION, vip: f.vip, relationship: f.relationship?.trim() || null });
  for (const t of touches) out.set(t.contact_id, { ...(out.get(t.contact_id) ?? NO_RELATION), lastInboundAt: t.last_inbound_at, lastOutboundAt: t.last_outbound_at });
  return out;
}
