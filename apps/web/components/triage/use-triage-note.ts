"use client";

// Reads why the AI labelled one conversation and whether it flagged it as suspicious, straight from the conversation's
// row when someone asks (hover, tap or opening it), so the list's own query is not widened for every row. The reason's
// words are sealed with the user's key. A reading is kept for a minute and thrown away when a newer message arrives.

import { useEffect, useState } from "react";
import { FIELD } from "@messages/crypto/fields";
import { supabase } from "@/lib/supabase";
import { open } from "@/lib/vault";

export interface TriageNote {
  code: string | null;
  words: string | null;
  suspicious: string | null;
}

const KEEP_MS = 60_000;
const cache = new Map<string, { at: number; version: string; note: Promise<TriageNote | null> }>();

async function read(threadId: string): Promise<TriageNote | null> {
  const { data, error } = await supabase.from("threads").select("triage_reason, triage_reason_text, suspicious").eq("id", threadId).maybeSingle();
  if (error || !data) return null; // before the migration is applied the columns are missing: no note, nothing breaks
  return { code: data.triage_reason, words: await open(FIELD.summary, data.triage_reason_text), suspicious: data.suspicious };
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
