// Loading conversations' messages on demand: opening, paging back, prefetching on hover, and dropping held ones.
// Split out of the store provider; the refs it shares with Realtime (use-realtime.ts) are passed in.

import { useCallback } from "react";
import { toast } from "sonner";
import { loadThread, loadThreadMessages, messageSentAt } from "../data";
import { touchHeld } from "./recent-threads";
import type { Action, State } from "./reducer";
import type { Thread } from "../types";

export interface ThreadLoadingDeps {
  rawDispatch: React.Dispatch<Action>;
  stateRef: React.MutableRefObject<State>;
  threadMapRef: React.MutableRefObject<Map<string, Thread>>;
  loadedRef: React.MutableRefObject<Set<string>>;
  loadingRef: React.MutableRefObject<Map<string, Promise<void>>>;
  moreRef: React.MutableRefObject<Map<string, boolean>>;
  olderRef: React.MutableRefObject<Set<string>>;
  heldRef: React.MutableRefObject<string[]>;
  openRef: React.MutableRefObject<string | null>;
  setLoadedThreadIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}

/** Message loading for the store: evictHeld is also handed to Realtime. */
export function useThreadLoading({ rawDispatch, stateRef, threadMapRef, loadedRef, loadingRef, moreRef, olderRef, heldRef, openRef, setLoadedThreadIds }: ThreadLoadingDeps) {
  const evictHeld = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const gone = new Set(ids);
    heldRef.current = heldRef.current.filter((id) => !gone.has(id));
    for (const id of ids) moreRef.current.delete(id);
    rawDispatch({ type: "evictMessages", ids });
    setLoadedThreadIds((prev) => { const next = new Set(prev); for (const id of ids) next.delete(id); return next; });
  }, []);

  // explicit is a conversation being opened; a prefetch (a hover) loads without becoming the one that is protected from eviction.
  const loadThreadInto = useCallback((threadId: string, aroundMessageId: string | undefined, explicit: boolean) => {
    if (explicit) openRef.current = threadId;
    const key = aroundMessageId ? `${threadId}:${aroundMessageId}` : threadId;
    const running = loadingRef.current.get(key);
    if (running) return running;
    const task = (async () => {
      try {
        const from = aroundMessageId ? await messageSentAt(threadId, aroundMessageId) : null;
        if (aroundMessageId && !from) return;
        // A jump into a loaded conversation fetches only the stretch older than what is there.
        const oldest = from && loadedRef.current.has(threadId) ? stateRef.current.byThread[threadId]?.[0] : undefined;
        const page = await loadThreadMessages(threadId, from ? { from, before: oldest } : {});
        // A jump keeps what is loaded; a fresh load replaces it.
        rawDispatch({ type: from ? "mergeMessages" : "setThreadMessages", threadId, messages: page.messages });
        moreRef.current.set(threadId, page.more);
        const { order, evict } = touchHeld(heldRef.current, threadId, openRef.current);
        heldRef.current = order;
        evictHeld(evict);
        setLoadedThreadIds((prev) => (prev.has(threadId) ? prev : new Set(prev).add(threadId)));
      } catch {
        toast("Could not load this conversation.");
      } finally {
        loadingRef.current.delete(key);
      }
    })();
    loadingRef.current.set(key, task);
    return task;
  }, [evictHeld]);
  const loadMessages = useCallback((threadId: string, aroundMessageId?: string) => loadThreadInto(threadId, aroundMessageId, true), [loadThreadInto]);

  const loadOlderMessages = useCallback(async (threadId: string) => {
    const oldest = stateRef.current.byThread[threadId]?.[0];
    if (!oldest || !moreRef.current.get(threadId) || olderRef.current.has(threadId)) return false;
    olderRef.current.add(threadId);
    try {
      const page = await loadThreadMessages(threadId, { before: oldest });
      moreRef.current.set(threadId, page.more);
      if (page.messages.length === 0) return false;
      rawDispatch({ type: "mergeMessages", threadId, messages: page.messages });
      return true;
    } catch {
      toast("Could not load earlier messages.");
      return false;
    } finally {
      olderRef.current.delete(threadId);
    }
  }, []);

  // Whether earlier messages are left to load, so a scroll near the top asks only when there is something to get.
  const hasOlder = useCallback((threadId: string) => !!moreRef.current.get(threadId), []);

  const prefetchMessages = useCallback((threadId: string) => {
    if (!loadedRef.current.has(threadId)) void loadThreadInto(threadId, undefined, false);
  }, [loadThreadInto]);

  const ensureThread = useCallback(async (threadId: string) => {
    if (threadMapRef.current.has(threadId)) return true;
    const loaded = await loadThread(threadId).catch(() => null);
    if (!loaded) return false;
    rawDispatch({ type: "upsertContacts", contacts: loaded.contacts });
    rawDispatch({ type: "upsertThread", thread: loaded.thread });
    return true;
  }, []);

  return { evictHeld, loadMessages, loadOlderMessages, hasOlder, prefetchMessages, ensureThread };
}
