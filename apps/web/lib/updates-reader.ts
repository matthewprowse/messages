// The Supabase calls behind What's New: published releases for any signed-in person, and remembering which one they last saw
// in the sign-in's user metadata (so it follows them between devices, like the onboarding flags). The database lets a
// non-owner read published rows only, so these calls need no owner check.

import { supabase } from "./supabase";
import { READER_COLUMNS, mapReaderUpdate, sortPublished, updateKey, type ReaderUpdate } from "./updates-seen";

// Plenty for a changelog; the list is not paged yet.
const LIMIT = 200;

/** Every published release, newest first. */
export async function loadPublishedUpdates(): Promise<ReaderUpdate[]> {
  const { data, error } = await supabase.from("updates").select(READER_COLUMNS).eq("published", true).limit(LIMIT);
  if (error) throw error;
  return sortPublished((data ?? []).map(mapReaderUpdate));
}

/** Remembers that this person has now seen the release. Failing is harmless: the dialog just opens once more next time. */
export async function markWhatsNewSeen(u: ReaderUpdate): Promise<void> {
  const { error } = await supabase.auth.updateUser({ data: { whatsNewSeen: updateKey(u) } });
  if (error) throw error;
}
