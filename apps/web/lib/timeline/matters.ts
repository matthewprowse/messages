// Matters (a deal, listing, policy or matter kept for one contact): the shapes, the row mapping, the name check and which
// timeline items a matter holds. Pure; matters-io.ts does the database and the sealing.

import { refKey, type RefKind } from "./types";

export const MATTER_KINDS = ["deal", "listing", "policy", "matter"] as const;
export type MatterKind = (typeof MATTER_KINDS)[number];
export const KIND_LABEL: Record<MatterKind, string> = { deal: "Deal", listing: "Listing", policy: "Policy", matter: "Matter" };

/** The longest a matter's name may be: it is a short label, not a description. */
export const MATTER_NAME_MAX = 60;

export interface Matter { id: string; contactId: string; name: string; kind: MatterKind; closed: boolean; createdAt: string; closedAt: string | null }

/** What a matter holds, as the link table stores it: one id of one kind. */
export interface MatterLink { id: string; matterId: string; kind: RefKind; targetId: string }

export interface MatterRow { id: string; contact_id: string; name: string; kind: string; status: string; created_at: string; closed_at: string | null }
export interface LinkRow { id: string; matter_id: string; thread_id: string | null; note_id: string | null; attachment_id: string | null; meeting_id: string | null }

/** A row (name already opened) as a matter. An unknown kind reads as a plain matter; a name that cannot be opened reads as its kind. */
export function mapMatter(r: MatterRow): Matter {
  const kind = MATTER_KINDS.find((k) => k === r.kind) ?? "matter";
  return { id: r.id, contactId: r.contact_id, name: r.name.trim() || KIND_LABEL[kind], kind, closed: r.status === "closed", createdAt: r.created_at, closedAt: r.closed_at };
}

/** A link row as one link, or null for a row with no target (the database forbids it). */
export function mapMatterLink(r: LinkRow): MatterLink | null {
  const pairs: [RefKind, string | null][] = [["thread", r.thread_id], ["note", r.note_id], ["attachment", r.attachment_id], ["meeting", r.meeting_id]];
  const hit = pairs.find(([, id]) => id);
  return hit ? { id: r.id, matterId: r.matter_id, kind: hit[0], targetId: hit[1]! } : null;
}

/** The column a kind of target is stored in. */
export const LINK_COLUMN = { thread: "thread_id", note: "note_id", attachment: "attachment_id", meeting: "meeting_id" } as const satisfies Record<RefKind, string>;

/** The name tidied, or an error sentence. Whitespace is squeezed; empty and too long are refused. */
export function checkMatterName(raw: string): { name: string; error: null } | { name: null; error: string } {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return { name: null, error: "Add a name." };
  if (name.length > MATTER_NAME_MAX) return { name: null, error: `Keep it to ${MATTER_NAME_MAX} characters.` };
  return { name, error: null };
}

/** The refs one matter holds, for filtering the timeline to it. */
export function matterRefs(links: MatterLink[], matterId: string): Set<string> {
  return new Set(links.filter((l) => l.matterId === matterId).map((l) => refKey(l.kind, l.targetId)));
}

/** Matters shown open first (newest first), then closed ones. */
export function sortMatters(matters: Matter[]): Matter[] {
  return [...matters].sort((a, b) => Number(a.closed) - Number(b.closed) || b.createdAt.localeCompare(a.createdAt));
}

/** The matters that hold an item (by any of its refs), for the badge on its row. */
export function mattersOf(refs: string[], links: MatterLink[], matters: Matter[]): Matter[] {
  const held = new Set(links.filter((l) => refs.includes(refKey(l.kind, l.targetId))).map((l) => l.matterId));
  return matters.filter((m) => held.has(m.id));
}

/**
 * The ref a row's "Add to Matter" links: the most specific thing it is (a file, a note, a meeting), else its conversation.
 * Linking a conversation brings in all its messages, promises and files at once, so a message links its conversation.
 */
export function linkRefOf(refs: string[]): { kind: RefKind; id: string } | null {
  const order: RefKind[] = ["attachment", "note", "meeting", "thread"];
  for (const kind of order) {
    const hit = refs.find((r) => r.startsWith(`${kind}:`));
    if (hit) return { kind, id: hit.slice(kind.length + 1) };
  }
  return null;
}
