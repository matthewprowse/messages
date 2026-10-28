// A merge gives a contact more addresses, but a conversation still belongs to the address it was had
// with. Replying with no inbound message to answer would otherwise mail every address the merged contact
// now has, so these are left out.

import { db, must } from "../db";

/**
 * Identity ids that reached these contacts by a merge (not undone) from a contact that was not in this
 * thread. Their addresses were never part of the conversation.
 */
export async function identitiesMergedFromElsewhere(threadId: string, contactIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (contactIds.length === 0) return out;
  const merges = must(
    await db.from("contact_merges").select("moved").in("kept_contact_id", contactIds).is("undone_at", null),
    "load merges for reply",
  );
  for (const m of merges) {
    const moved = (m.moved ?? {}) as Record<string, unknown>;
    const list = (k: string) => (Array.isArray(moved[k]) ? (moved[k] as unknown[]).map(String) : []);
    if (list("participants_moved").includes(threadId) || list("participants_dropped").includes(threadId)) continue;
    for (const id of list("identities")) out.add(id);
  }
  return out;
}
