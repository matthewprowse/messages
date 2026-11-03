"use client";

// Reads whether the AI flagged one conversation as suspicious (likely phishing or payment fraud), straight from the
// conversation's row when it is opened, so the list's own query is not widened for every row. A reading is kept for a
// minute and thrown away when a newer message arrives.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export interface TriageNote {
  suspicious: string | null;
}

const KEEP_MS = 60_000;
const cache = new Map<string, { at: number; version: string; note: Promise<TriageNote | null> }>();

async function read(threadId: string): Promise<TriageNote | null> {
  const { data, error } = await supabase.from("threads").select("suspicious").eq("id", threadId).maybeSingle();
  if (error || !data) return null;
  return { suspicious: data.suspicious };
}

/** The note for a conversation, or null while loading or when there is none. `version` changes when the conversation does (its latest message time). */
export function useTriageNote(threadId: string, version: string, enabled = true): TriageNote | null {
  const [note, setNote] = useState<TriageNote | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const kept = cache.get(threadId);
    const fresh = kept && kept.version === version && Date.now() - kept.at < KEEP_MS ? kept : { at: Date.now(), version, note: read(threadId).catch(() => null) };
    cache.set(threadId, fresh);
    fresh.note.then((n) => { if (!cancelled) setNote(n); });
    return () => { cancelled = true; };
  }, [threadId, version, enabled]);
  return note;
}
