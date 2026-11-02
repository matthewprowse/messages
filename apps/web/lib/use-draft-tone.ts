"use client";

// Reads and saves the default draft tone (profiles.draft_tone). The AI worker reads the column itself when it writes a
// draft, so nothing else needs passing. Kept apart from the store's profile so that change touches no shared mapping.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./auth";
import { toDraftTone, type DraftTone } from "./draft-tone";

/** The default tone (null for your usual voice) and a setter that puts it back when the save fails. undefined while loading. */
export function useDraftTone() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [tone, setTone] = useState<DraftTone | null | undefined>(undefined);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    void supabase.from("profiles").select("draft_tone").eq("user_id", userId).maybeSingle().then(({ data }) => { if (live) setTone(toDraftTone(data?.draft_tone)); });
    return () => { live = false; };
  }, [userId]);

  const save = useCallback(async (next: DraftTone | null): Promise<boolean> => {
    if (!userId) return false;
    const before = tone;
    setTone(next);
    const { error } = await supabase.from("profiles").upsert({ user_id: userId, draft_tone: next }, { onConflict: "user_id" });
    if (error) { setTone(before); return false; }
    return true;
  }, [userId, tone]);

  return { tone, save };
}
