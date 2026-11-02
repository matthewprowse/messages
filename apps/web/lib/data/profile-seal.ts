// Sealing the profile's two free-text columns (About and Important People name real people, so they are encrypted like
// every other personal field). Rows written before that hold plain text; they are read as they are and sealed the
// next time the profile loads (a lazy upgrade, no one-off migration to run).

import { open, seal } from "../vault";
import { supabase } from "../supabase";
import { PROFILE_TEXT, plainColumns, type ProfileTextColumn } from "./profile-text";

type TextColumns = Partial<Record<ProfileTextColumn, string | null>>;

/** A profile change as columns with the free text sealed. Anything without free text comes back as it is. */
export async function sealProfileColumns<T extends TextColumns>(columns: T): Promise<T> {
  const out: TextColumns = { ...columns };
  for (const { column, field } of PROFILE_TEXT) {
    const v = out[column];
    if (typeof v === "string" && v !== "") out[column] = await seal(field, v);
  }
  return out as T;
}

/**
 * Opens the profile's text in place. Plain values (older rows) are sealed in the background for next time; a failed
 * upgrade is harmless, it is tried again at the next load.
 */
export async function openProfileRow<T extends TextColumns>(row: T | null): Promise<T | null> {
  if (!row) return row;
  const stale = plainColumns(row);
  const before: TextColumns = { ...row };
  for (const { column, field } of PROFILE_TEXT) {
    const v = row[column];
    if (typeof v === "string") (row as TextColumns)[column] = (await open(field, v)) ?? "";
  }
  if (stale.length > 0) {
    void (async () => {
      const userId = (await supabase.auth.getSession()).data.session?.user.id;
      if (!userId) return;
      const sealed = await sealProfileColumns(Object.fromEntries(stale.map((c) => [c, before[c]])) as TextColumns);
      await supabase.from("profiles").update(sealed).eq("user_id", userId);
    })().catch(() => {});
  }
  return row;
}
