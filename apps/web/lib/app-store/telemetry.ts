// Content-free usage events for the app store (store.tsx): corrections to the AI's labels and bulk mail actions. Sends
// prompt codes, traits and counts, never any text.


import type { Thread } from "../types";
import { supabase } from "../supabase";
import { track } from "../analytics";
import { minutesBucket, type Events } from "@messages/analytics";

/**
 * What the AI said about a conversation's latest message (its prompt code and the traits stored with it: sender kind,
 * channel, length and so on, never any text), for usage analytics. Empty when unknown or the lookup fails.
 */
export async function aiRecord(threadId: string): Promise<Record<string, unknown>> {
  try {
    const { data } = await supabase.from("message_ai").select("prompt_version, traits, messages!inner(thread_id)")
      .eq("messages.thread_id", threadId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const traits = data?.traits && typeof data.traits === "object" && !Array.isArray(data.traits) ? data.traits : {};
    return { ...(data?.prompt_version ? { prompt: data.prompt_version } : {}), ...traits };
  } catch {
    return {};
  }
}

/** A label you changed, against what you were shown, for the correction rates. Nothing is recorded when it did not change. */
export function recordCorrection(threadId: string, field: "priority" | "junk", from: string, to: string) {
  if (from === to) return;
  void aiRecord(threadId).then((ai) => track("label_corrected", { field, from, to, ...ai } as Events["label_corrected"]));
}

/** Something done to conversations: which action, whether it had been read first, and how long after the last message. */
export function recordAction(threads: Thread[], action: string) {
  for (const t of threads.slice(0, 3)) {
    const base = { action, opened_first: !t.unread, mins_since: minutesBucket(Math.max(0, (Date.now() - Date.parse(t.lastMessageAt)) / 60_000)) };
    void aiRecord(t.id).then((ai) => track("thread_action", { ...ai, ...base } as Events["thread_action"]));
  }
  if (threads.length > 3) track("thread_action", { action: `${action}_many`, opened_first: false, mins_since: 0 } as Events["thread_action"]);
}
