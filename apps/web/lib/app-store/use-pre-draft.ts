// Pre-drafts: asks the AI worker for a draft of a conversation's latest message once the app has seen it settle.
// Split out of the store provider; the timers are cleared on sign-out so nothing fires for the wrong user.

import { useCallback, useEffect, useRef } from "react";
import type { Thread } from "../types";
import { supabase } from "../supabase";
import { track } from "../analytics";
import { PRE_DRAFT_QUIET_MS, mayPreDraft } from "./draft-helpers";
import type { State } from "./reducer";

/** Returns requestAutoDraft (ask now, once per state) and schedulePreDraft (ask after the conversation goes quiet). */
export function usePreDraft({ userId, threadMapRef, stateRef }: { userId: string | null; threadMapRef: React.MutableRefObject<Map<string, Thread>>; stateRef: React.MutableRefObject<State> }) {
  // Pre-drafts: one per conversation's latest message, asked for once the app has seen it settle (its
  // triage included, which changes the key), never again for the same state.
  const preDraftAskedRef = useRef(new Set<string>());
  const preDraftTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const requestAutoDraft = useCallback(async (threadId: string) => {
    const t = threadMapRef.current.get(threadId);
    if (!userId || !t || !mayPreDraft(t, stateRef.current.profile)) return;
    const key = `${t.id}:${t.lastMessageAt}:${t.category}:${t.needsReply}`;
    if (preDraftAskedRef.current.has(key)) return;
    preDraftAskedRef.current.add(key);
    const { data, error } = await supabase.rpc("request_auto_draft", { p_thread: threadId });
    if (error) preDraftAskedRef.current.delete(key); // a failed ask can be made again
    if (data) track("draft_requested", { tone: "default", source: "auto", channel: t.channel });
  }, [userId]);
  // While the app is open and in view, a conversation that changed is asked about once it has been
  // quiet for PRE_DRAFT_QUIET_MS. With the app closed or hidden, opening the conversation asks instead.
  const schedulePreDraft = useCallback((threadId: string) => {
    const timers = preDraftTimersRef.current;
    clearTimeout(timers.get(threadId));
    timers.set(threadId, setTimeout(() => {
      timers.delete(threadId);
      if (document.visibilityState === "visible") void requestAutoDraft(threadId);
    }, PRE_DRAFT_QUIET_MS));
  }, [requestAutoDraft]);
  useEffect(() => {
    const timers = preDraftTimersRef.current;
    return () => { for (const t of timers.values()) clearTimeout(t); timers.clear(); };
  }, [userId]);

  return { requestAutoDraft, schedulePreDraft };
}
