"use client";

// The user's open promises, shared by the Summary section and the strip in an open conversation: loaded once, kept
// current by one Realtime subscription to public.commitments, and changed at once when ticked or snoozed (put back with
// a toast if saving fails). Not in the app store on purpose: promises are a side feature and the store stays small.
// Each Realtime row is opened and patched in on its own (lib/commitments.ts); while nothing is mounted nothing listens,
// so the next mount shows the list it had and reads it again underneath.

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import { useAuth } from "@/lib/auth";
import { applyCommitment, removeCommitment, type Commitment } from "@/lib/commitments";
import { loadCommitments, openCommitment, saveDone, saveSnooze } from "@/lib/commitments-io";
import { onClearMemory } from "@/lib/memory-cache";
import { supabase } from "@/lib/supabase";

const RELOAD_MS = 800; // a row that cannot be patched (a column missing from the payload) reloads, once per burst

const EMPTY: Commitment[] = [];
let items: Commitment[] = EMPTY;
let loadedFor: string | null = null;
let channel: RealtimeChannel | null = null;
let users = 0;
// Realtime rows are opened one after another, so a quick update after an insert cannot land before it.
let patching: Promise<void> = Promise.resolve();
let reloadTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function set(next: Commitment[]) {
  items = next;
  for (const l of listeners) l();
}

// The promise text is decrypted here, so sign out empties it.
onClearMemory(() => {
  loadedFor = null;
  set(EMPTY);
});

function reload() {
  // A failed load (the table not there yet) keeps what is shown: promises are optional.
  loadCommitments().then(set, () => {});
}

function reloadSoon() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(reload, RELOAD_MS);
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
      set(EMPTY);
      reload();
    } else if (!channel) {
      // Nobody listened while the promises were off screen, so changes may have been missed: the list stays and is read again.
      reload();
    }
    users += 1;
    const onChange = (payload: { eventType: string; new: unknown; old: unknown }) => {
      if (payload.eventType === "DELETE") {
        const id = (payload.old as { id?: string } | null)?.id;
        if (id) set(removeCommitment(items, id));
        else reloadSoon();
        return;
      }
      patching = patching.then(async () => {
        const row = await openCommitment(payload.new as Parameters<typeof openCommitment>[0]).catch(() => null);
        if (loadedFor !== userId) return;
        if (row) set(applyCommitment(items, row));
        else reloadSoon();
      });
    };
    if (!channel) {
      channel = supabase
        .channel(`commitments-${userId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "commitments", filter: `user_id=eq.${userId}` }, onChange)
        // Refused while the table is not published, so it stops instead of rejoining forever.
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR" && channel) { void supabase.removeChannel(channel); channel = null; }
        });
    }
    return () => {
      users -= 1;
      if (users === 0 && channel) { clearTimeout(reloadTimer); void supabase.removeChannel(channel); channel = null; }
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
