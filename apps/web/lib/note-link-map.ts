// Pure mapping between a note's links as the app holds them and the note_links rows (one nullable column per kind),
// plus the labels the link chips show. No Supabase or React, so it runs under node:test.

export type LinkKind = "contact" | "thread" | "event";

/** What a note is linked to. */
export interface LinkTarget { kind: LinkKind; id: string }

/** A note_links row as read back. */
export interface LinkRow { id: string; note_id: string; contact_id: string | null; thread_id: string | null; event_id: string | null }

const COLUMN = { contact: "contact_id", thread: "thread_id", event: "event_id" } as const;

/** The note_links column that holds ids of this kind. */
export const linkColumn = (kind: LinkKind) => COLUMN[kind];

/** The row to insert for a link: exactly one target column set, as the database insists. */
export function linkInsert(noteId: string, target: LinkTarget): { note_id: string } & Partial<Record<(typeof COLUMN)[LinkKind], string>> {
  return { note_id: noteId, [COLUMN[target.kind]]: target.id };
}

/** The target a stored row points at, or null for a row with none (cannot happen past the check constraint). */
export function targetOfRow(row: Pick<LinkRow, "contact_id" | "thread_id" | "event_id">): LinkTarget | null {
  if (row.contact_id) return { kind: "contact", id: row.contact_id };
  if (row.thread_id) return { kind: "thread", id: row.thread_id };
  if (row.event_id) return { kind: "event", id: row.event_id };
  return null;
}

/** One string per target, for sets and keys. */
export const linkKey = (t: LinkTarget) => `${t.kind}:${t.id}`;

/** The targets with repeats dropped, first one kept. */
export function uniqueTargets(list: LinkTarget[]): LinkTarget[] {
  const seen = new Set<string>();
  return list.filter((t) => (seen.has(linkKey(t)) ? false : (seen.add(linkKey(t)), true)));
}

/** The in-app page a link opens. Events have no page of their own: the calendar shows them. */
export function linkHref(t: LinkTarget): string {
  return t.kind === "contact" ? `/contacts/${t.id}` : t.kind === "thread" ? `/inbox/${t.id}` : "/calendar";
}

/** A conversation's name for a chip: a group's name, else the subject, else the person or number it is with. */
export function threadLabel(t: { isGroup?: boolean; groupName?: string; subject?: string; fallbackName?: string; participantIds: string[] }, nameOf: (contactId: string) => string | undefined): string {
  const person = t.participantIds.map(nameOf).find(Boolean);
  return (t.isGroup && t.groupName?.trim()) || t.subject?.trim() || person || t.fallbackName?.trim() || "Conversation";
}

/** The conversation or contact a screen is about, read from its path, so a note started there is linked to it. */
export function targetOfPath(pathname: string): LinkTarget | null {
  const m = /^\/(inbox|contacts)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i.exec(pathname);
  return m ? { kind: m[1] === "inbox" ? "thread" : "contact", id: m[2] } : null;
}

/** The title a note starts with when made from a conversation: its subject, or its label when there is none. */
export function captureTitle(t: { subject?: string } | undefined, label: string): string {
  return t?.subject?.trim() || label;
}
