"use client";

// The meetings for a conversation's people, a contact or a calendar event, kept live. Every screen that
// shows meetings shares one Realtime subscription to the meetings table: any change (a transcript or
// summary written, people matched, a meeting tied to its event) reloads what each screen shows, a moment
// later so a burst of changes is one reload. What was loaded is kept per scope, so coming back to a
// conversation shows its meetings at once while they refresh.

import { useEffect, useMemo, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useAuth } from "@/lib/auth";
import { loadMeetingsForEvent, loadMeetingsWith, type Meeting } from "@/lib/meetings";
import { supabase } from "@/lib/supabase";

const RELOAD_MS = 800;

export type MeetingScope = { contactIds: string[] } | { eventId: string };

const NONE: Meeting[] = [];
const cache = new Map<string, Meeting[]>();
const listeners = new Set<(deletedId?: string) => void>();
let channel: RealtimeChannel | null = null;
let channelUser: string | null = null;

function listen(userId: string, onChange: (deletedId?: string) => void): () => void {
  listeners.add(onChange);
  if (!channel || channelUser !== userId) {
    if (channel) void supabase.removeChannel(channel);
    channelUser = userId;
    const notify = (deletedId?: string) => { for (const l of listeners) l(deletedId); };
    channel = supabase
      .channel(`meetings-${userId}`)
      // Realtime applies a row filter to inserts and updates only; a deletion carries just the id.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "meetings" }, (payload) => notify((payload.old as { id?: string }).id))
      .on("postgres_changes", { event: "*", schema: "public", table: "meetings", filter: `user_id=eq.${userId}` }, (payload) => {
        if (payload.eventType !== "DELETE") notify();
      })
      // Refused while the table is not published, so it stops instead of rejoining forever.
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" && channel) {
          void supabase.removeChannel(channel);
          channel = null;
          channelUser = null;
        }
      });
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && channel) {
      void supabase.removeChannel(channel);
      channel = null;
      channelUser = null;
    }
  };
}

function keyOf(scope: MeetingScope | null): string | null {
  if (!scope) return null;
  if ("eventId" in scope) return `event:${scope.eventId}`;
  return scope.contactIds.length ? `contacts:${[...new Set(scope.contactIds)].sort().join(",")}` : null;
}

/** Meetings for the scope, newest first. Null scope, or no contacts, is none. */
export function useMeetings(scope: MeetingScope | null): { meetings: Meeting[]; loading: boolean } {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  // Kept per signed-in user, so signing in as someone else never shows the last person's meetings.
  const scoped = keyOf(scope);
  const key = userId && scoped ? `${userId}|${scoped}` : null;
  const [state, setState] = useState<{ key: string | null; meetings: Meeting[]; loading: boolean }>(() => ({ key, meetings: (key && cache.get(key)) || NONE, loading: !!key && !cache.has(key) }));
  // The scope as a stable value, so a new array of the same contacts does not reload.
  const stable = useMemo(() => scope, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!key || !stable || !userId) {
      setState({ key, meetings: NONE, loading: false });
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState({ key, meetings: cache.get(key) ?? NONE, loading: !cache.has(key) });
    const load = () => {
      const run = "eventId" in stable ? loadMeetingsForEvent(stable.eventId) : loadMeetingsWith(stable.contactIds);
      run.then(
        (meetings) => {
          cache.set(key, meetings);
          if (live) setState({ key, meetings, loading: false });
        },
        () => { if (live) setState((s) => ({ ...s, loading: false })); }, // a failed load keeps what was shown
      );
    };
    load();
    const stop = listen(userId, (deletedId) => {
      if (deletedId && !(cache.get(key) ?? NONE).some((m) => m.id === deletedId)) return;
      clearTimeout(timer);
      timer = setTimeout(load, RELOAD_MS);
    });
    return () => {
      live = false;
      clearTimeout(timer);
      stop();
    };
  }, [key, stable, userId]);

  return state.key === key ? { meetings: state.meetings, loading: state.loading } : { meetings: (key && cache.get(key)) || NONE, loading: !!key && !cache.has(key) };
}
