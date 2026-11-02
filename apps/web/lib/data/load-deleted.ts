// Reads the conversations in the bin for the Inbox's Deleted view. They are left out of the store (loadEverything skips
// them), so this runs when the view is opened.

import { openThreads } from "../open-rows";
import { supabase } from "../supabase";
import type { Thread } from "../types";
import { whenPhoneFormatReady } from "../format";
import { THREAD_WITH_IDS } from "./columns";
import { threadWithIds } from "./map-thread";
import { myId } from "./load-small";

/** The newest deleted conversations shown; older ones are still at the provider. */
const DELETED_LIMIT = 200;

/** The user's deleted conversations, newest first. Throws when they cannot be read. */
export async function loadDeletedThreads(): Promise<Thread[]> {
  const me = await myId();
  const { data, error } = await supabase.from("threads").select(THREAD_WITH_IDS).eq("user_id", me).eq("status", "trash")
    .order("last_message_at", { ascending: false, nullsFirst: false }).limit(DELETED_LIMIT);
  if (error) throw error;
  await Promise.all([openThreads(data ?? []), whenPhoneFormatReady()]);
  return (data ?? []).map(threadWithIds);
}
