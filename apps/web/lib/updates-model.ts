// The changelog's shape and rules with no network in them: mapping a database row, what is wrong with a draft, ordering,
// the next version number and the date helpers. lib/updates.ts (the Supabase calls) re-exports all of it.

import type { Tables } from "@messages/db";

export type ChangeKind = "new" | "improved" | "fixed";
export const CHANGE_KINDS: { key: ChangeKind; label: string }[] = [
  { key: "new", label: "New" },
  { key: "improved", label: "Improved" },
  { key: "fixed", label: "Fixed" },
];

export interface Change { kind: ChangeKind; text: string }
export interface Update {
  id: string;
  version: string;
  title: string;
  summary: string;
  changes: Change[];
  /** The day it is dated, as YYYY-MM-DD. */
  releasedOn: string;
  published: boolean;
  /** When the row was first written; with releasedOn it fixes the order, so an edit never moves a row. */
  createdAt: string;
  /** The row's updated_at as loaded. A save only goes through while the row still has it. */
  updatedAt: string;
}
export type UpdateDraft = Omit<Update, "id" | "createdAt" | "updatedAt"> & { id?: string; updatedAt?: string };

export const COLUMNS = "id, version, title, summary, changes, released_on, published, created_at, updated_at";
export type Row = Pick<Tables<"updates">, "id" | "version" | "title" | "summary" | "changes" | "released_on" | "published" | "created_at" | "updated_at">;

const isKind = (k: unknown): k is ChangeKind => k === "new" || k === "improved" || k === "fixed";

export function mapUpdate(row: Row): Update {
  const list = Array.isArray(row.changes) ? row.changes : [];
  return {
    id: row.id,
    version: row.version ?? "",
    title: row.title,
    summary: row.summary ?? "",
    changes: list.flatMap((c) => {
      const item = c as { kind?: unknown; text?: unknown };
      return isKind(item.kind) && typeof item.text === "string" ? [{ kind: item.kind, text: item.text }] : [];
    }),
    releasedOn: row.released_on,
    published: row.published,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** What a draft says is wrong with it, or null. The database checks the same limits. */
export function updateProblem(d: Pick<UpdateDraft, "title" | "summary" | "changes" | "version">): string | null {
  if (!d.title.trim()) return "Enter a title.";
  if (d.title.trim().length > 120) return "Keep the title under 120 characters.";
  if (d.version.trim().length > 20) return "Keep the version under 20 characters.";
  if (d.summary.length > 500) return "Keep the summary under 500 characters.";
  if (d.changes.some((c) => c.text.trim().length > 300)) return "Keep each change under 300 characters.";
  return null;
}

/** The changes with blank lines dropped, ready to store. */
export const cleanChanges = (changes: Change[]): Change[] => changes.map((c) => ({ kind: c.kind, text: c.text.trim() })).filter((c) => c.text);

/** A reason to stop before publishing a release that says nothing changed, or null. */
export const publishWarning = (d: Pick<UpdateDraft, "published" | "changes">): string | null => (d.published && cleanChanges(d.changes).length === 0 ? "This release is marked Published but lists no changes." : null);

/** Newest first: by release date, then the one written last. Same as the database order, and unmoved by an edit because it
 * uses created_at, which an edit does not change. */
export function sortUpdates(list: Update[]): Update[] {
  return [...list].sort((a, b) => b.releasedOn.localeCompare(a.releasedOn) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

/** The next patch version after the highest "1.2.3" or "v1.2.3" in the list ("" when there is none), keeping a leading v. */
export function nextVersion(list: Pick<Update, "version">[]): string {
  let best: { parts: [number, number, number]; v: boolean } | null = null;
  for (const u of list) {
    const m = /^(v?)(\d+)\.(\d+)\.(\d+)$/.exec(u.version.trim());
    if (!m) continue;
    const parts: [number, number, number] = [Number(m[2]), Number(m[3]), Number(m[4])];
    const diff = best ? parts[0] - best.parts[0] || parts[1] - best.parts[1] || parts[2] - best.parts[2] : 1;
    if (diff > 0) best = { parts, v: m[1] === "v" };
  }
  return best ? `${best.v ? "v" : ""}${best.parts[0]}.${best.parts[1]}.${best.parts[2] + 1}` : "";
}

/** A YYYY-MM-DD key as a local date, or undefined when it is not one. */
export function fromDateKey(key: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
}

/** "17 November 2026" for a YYYY-MM-DD key; empty when the key is not a date. */
export const dayLabel = (key: string): string => fromDateKey(key)?.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) ?? "";

/** The text that tells whether a draft differs from what it started as. */
export const draftSnapshot = (d: UpdateDraft): string => JSON.stringify([d.version.trim(), d.title.trim(), d.summary.trim(), cleanChanges(d.changes), d.releasedOn, d.published]);
