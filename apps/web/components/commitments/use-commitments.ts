"use client";

// The user's open promises, shared by the Summary section and the strip in an open conversation: loaded once, kept
// current by one Realtime subscription to public.commitments, and changed at once when ticked or snoozed (put back with
// a toast if saving fails). Not in the app store on purpose: promises are a side feature and the store stays small.

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import { useAuth } from "@/lib/auth";
import type { Commitment } from "@/lib/commitments";
import { loadCommitments, saveDone, saveSnooze } from "@/lib/commitments-io";
import { supabase } from "@/lib/supabase";

const RELOAD_MS = 800; // a burst of worker writes is one reload

const EMPTY: Commitment[] = [];
let items: Commitment[] = EMPTY;
let loadedFor: string | null = null;
let channel: RealtimeChannel | null = null;
let users = 0;
const listeners = new Set<() => void>();

function set(next: Commitment[]) {
  items = next;
  for (const l of listeners) l();
}

function reload() {
  // A failed load (the table not there yet) keeps what is shown: promises are optional.
  loadCommitments().then(set, () => {});
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Open promises (empty until loaded or when none), with Done and Snooze. */
export function useCommitments() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const all = useSyncExternalStore(subscribe, () => items, () => EMPTY);

  useEffect(() => {
    if (!userId) return;
    if (loadedFor !== userId) {
      loadedFor = userId;
      items = EMPTY;
      reload();
    }
    users += 1;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!channel) {
      channel = supabase
        .channel(`commitments-${userId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "commitments", filter: `user_id=eq.${userId}` }, () => {
          clearTimeout(timer);
          timer = setTimeout(reload, RELOAD_MS);
        })
        // Refused while the table is not published, so it stops instead of rejoining forever.
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR" && channel) { void supabase.removeChannel(channel); channel = null; }
        });
    }
    return () => {
      clearTimeout(timer);
      users -= 1;
      if (users === 0 && channel) { void supabase.removeChannel(channel); channel = null; }
    };
  }, [userId]);

  const change = useCallback((c: Commitment, patch: Partial<Commitment>, save: () => Promise<void>, failure: string) => {
    const before = items;
    set(items.map((x) => (x.id === c.id ? { ...x, ...patch } : x)));
    save().catch(() => {
      set(before);
      toast.error(failure);
    });
  }, []);

  const done = useCallback((c: Commitment) => {
    track("feature_used", { feature: "promise_done", detail: c.owner });
    // A done promise leaves the list at once.
    const before = items;
    set(items.filter((x) => x.id !== c.id));
    saveDone(c.id).catch(() => { set(before); toast.error("Could not mark that promise done."); });
  }, []);

  const snooze = useCallback((c: Commitment, until: Date) => {
    track("feature_used", { feature: "promise_snooze", detail: c.owner });
    change(c, { snoozedUntil: until.toISOString() }, () => saveSnooze(c.id, until.toISOString()), "Could not snooze that promise.");
  }, [change]);

  return { all, done, snooze };
}
