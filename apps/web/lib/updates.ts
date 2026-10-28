// The changelog (public.updates): what changed in each release, written before the code is pushed. Only the owner can read or
// write it for now; the database refuses everyone else. The functions here keep the rows and the page's shape apart.

import type { Json, Tables } from "@messages/db";
import { supabase } from "./supabase";

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
}
export type UpdateDraft = Omit<Update, "id"> & { id?: string };

const COLUMNS = "id, version, title, summary, changes, released_on, published, created_at";
type Row = Pick<Tables<"updates">, "id" | "version" | "title" | "summary" | "changes" | "released_on" | "published">;

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

/** Newest first: by date, then the one written last. Drafts stay among the rest. */
export function sortUpdates(list: Update[]): Update[] {
  return [...list].sort((a, b) => b.releasedOn.localeCompare(a.releasedOn));
}

export async function loadUpdates(): Promise<Update[]> {
  const { data, error } = await supabase.from("updates").select(COLUMNS).order("released_on", { ascending: false }).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapUpdate);
}

export async function saveUpdate(d: UpdateDraft): Promise<Update> {
  const fields = {
    version: d.version.trim() || null,
    title: d.title.trim(),
    summary: d.summary.trim() || null,
    changes: cleanChanges(d.changes) as unknown as Json,
    released_on: d.releasedOn,
    published: d.published,
  };
  const query = d.id ? supabase.from("updates").update(fields).eq("id", d.id) : supabase.from("updates").insert(fields);
  const { data, error } = await query.select(COLUMNS).single();
  if (error) throw error;
  return mapUpdate(data);
}

export async function deleteUpdate(id: string): Promise<void> {
  const { error } = await supabase.from("updates").delete().eq("id", id);
  if (error) throw error;
}
