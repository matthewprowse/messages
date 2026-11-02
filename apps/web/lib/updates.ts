// The changelog (public.updates): what changed in each release, written before the code is pushed. Only the owner can read or
// write it for now; the database refuses everyone else. This file is the Supabase calls; the shape, rules and ordering are in
// updates-model.ts (tested) and re-exported here.

import type { Json } from "@messages/db";
import { supabase } from "./supabase";
import { COLUMNS, cleanChanges, mapUpdate, type Update, type UpdateDraft } from "./updates-model";

export * from "./updates-model";

/** Thrown by saveUpdate when the row changed since the draft was loaded (another tab or device saved it). */
export class StaleUpdateError extends Error {
  constructor() {
    super("The update changed elsewhere");
  }
}

// Plenty for a changelog; the list is not paged yet.
const LIMIT = 200;

export async function loadUpdates(): Promise<Update[]> {
  const { data, error } = await supabase.from("updates").select(COLUMNS).order("released_on", { ascending: false }).order("created_at", { ascending: false }).limit(LIMIT);
  if (error) throw error;
  return (data ?? []).map(mapUpdate);
}

/** Writes a draft. An existing row is only changed while its updated_at is still the one the draft was loaded with, so a
 * stale dialog cannot overwrite newer text: it throws StaleUpdateError instead. */
export async function saveUpdate(d: UpdateDraft): Promise<Update> {
  const fields = {
    version: d.version.trim() || null,
    title: d.title.trim(),
    summary: d.summary.trim() || null,
    changes: cleanChanges(d.changes) as unknown as Json,
    released_on: d.releasedOn,
    published: d.published,
  };
  if (!d.id) {
    const { data, error } = await supabase.from("updates").insert(fields).select(COLUMNS).single();
    if (error) throw error;
    return mapUpdate(data);
  }
  let query = supabase.from("updates").update(fields).eq("id", d.id);
  if (d.updatedAt) query = query.eq("updated_at", d.updatedAt);
  const { data, error } = await query.select(COLUMNS).maybeSingle();
  if (error) throw error;
  if (!data) throw new StaleUpdateError();
  return mapUpdate(data);
}

export async function deleteUpdate(id: string): Promise<void> {
  const { error } = await supabase.from("updates").delete().eq("id", id);
  if (error) throw error;
}
