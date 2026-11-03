"use client";

// The published releases for Settings, What's New, and whether the newest is one this person has not seen yet, which puts a
// dot on its row in the Settings list. Seen is the same marker the What's New dialog keeps (lib/updates-seen.ts).

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { loadPublishedUpdates } from "@/lib/updates-reader";
import { latestUpdate, seenFromMetadata, shouldShowWhatsNew, type ReaderUpdate } from "@/lib/updates-seen";

/** Every published release, newest first: undefined while loading, null when it failed. `reload` tries again. */
export function usePublishedUpdates() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [updates, setUpdates] = useState<ReaderUpdate[] | null | undefined>(undefined);
  const load = useCallback(() => {
    setUpdates(undefined);
    loadPublishedUpdates().then(setUpdates).catch(() => setUpdates(null));
  }, []);
  useEffect(() => { if (userId) load(); }, [userId, load]);
  return { updates, reload: load };
}

/** True when the newest release went out after the one this person last saw (or after they joined). */
export function useWhatsNewUnseen(): boolean {
  const { session } = useAuth();
  const { updates } = usePublishedUpdates();
  if (!session || !updates) return false;
  return shouldShowWhatsNew({ latest: latestUpdate(updates), seen: seenFromMetadata(session.user.user_metadata), joinedAt: session.user.created_at, onboarding: undefined });
}
