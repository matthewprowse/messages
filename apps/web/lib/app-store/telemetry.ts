// Content-free usage events for the app store (store.tsx): corrections to the AI's labels and bulk mail actions. Sends
// prompt codes, named traits and counts, never any text.

import type { Thread } from "../types";
import { supabase } from "../supabase";
import { track } from "../analytics";
import { minutesBucket, type Events, type LabelField } from "@messages/analytics";

/** The only keys of the AI's stored traits that reach an event. Named, so a new key the AI worker stores cannot slip through. */
const TRAIT_KEYS = ["channel", "sender", "bulk", "attach", "len", "hour", "known", "source"] as const;
/** The most conversations of one bulk action that get their own event; the rest are counted in one `_many` event. */
const MAX_PER_ACTION = 25;
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; value: Promise<Record<string, unknown>> }>();

/**
 * What the AI said about a conversation's latest message (its prompt code and the named traits stored with it: sender
 * kind, channel, length and so on, never any text), for usage analytics. Empty when unknown or the lookup fails. Kept for
 * a minute per conversation, so a bulk action or a label and its correction do not each read the row again.
 */
export function aiRecord(threadId: string): Promise<Record<string, unknown>> {
  const hit = cache.get(threadId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = lookup(threadId);
  cache.set(threadId, { at: Date.now(), value });
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return value;
}

async function lookup(threadId: string): Promise<Record<string, unknown>> {
  try {
    const { data } = await supabase.from("message_ai").select("prompt_version, traits, messages!inner(thread_id)")
      .eq("messages.thread_id", threadId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const traits = data?.traits && typeof data.traits === "object" && !Array.isArray(data.traits) ? (data.traits as Record<string, unknown>) : {};
    const named = Object.fromEntries(TRAIT_KEYS.filter((k) => traits[k] !== undefined).map((k) => [k, traits[k]]));
    return { ...(data?.prompt_version ? { prompt: data.prompt_version } : {}), ...named };
  } catch {
    return {};
  }
}

/** A label you changed, against what you were shown, for the correction rates. Nothing is recorded when it did not change. */
export function recordCorrection(threadId: string, field: LabelField, from: string, to: string) {
  if (from === to) return;
  void aiRecord(threadId).then((ai) => track("label_corrected", { field, from, to, ...ai } as Events["label_corrected"]));
}

/** Corrections for a bulk action: up to MAX_PER_ACTION get one each, so the rate is not biased towards small actions. */
export function recordCorrections(threads: Thread[], field: LabelField, label: (t: Thread) => string, to: string) {
  for (const t of threads.slice(0, MAX_PER_ACTION)) recordCorrection(t.id, field, label(t), to);
}

/** Something done to conversations: which action, whether it had been read first, and how long after the last message. */
export function recordAction(threads: Thread[], action: string) {
  for (const t of threads.slice(0, MAX_PER_ACTION)) {
    const base = { action, opened_first: !t.unread, mins_since: minutesBucket(Math.max(0, (Date.now() - Date.parse(t.lastMessageAt)) / 60_000)) };
    void aiRecord(t.id).then((ai) => track("thread_action", { ...ai, ...base } as Events["thread_action"]));
  }
  if (threads.length > MAX_PER_ACTION) track("thread_action", { action: `${action}_many`, opened_first: false, mins_since: 0 } as Events["thread_action"]);
}
