"use client";

// The app store: AppProvider loads conversations, contacts and tasks, keeps them live, and exposes every action the
// screens call (read, archive, draft, send) through useApp. It owns the state and refs and wires the parts together;
// the actions live in app-store/ (use-thread-actions, use-outbox, use-drafts, use-tasks and the rest).

import { useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import type { ListFilter, Thread, View } from "./types";
import { useAuth } from "./auth";
import { loadContacts, loadEverything, loadOutbox } from "./data";
import { followMerges } from "./merging";
import { mergePending } from "./outbox-load";
import { ComposeDraft, ComposeStatus, PendingSend } from "./app-store/compose";
import { AppContext, Ctx, DraftPhase } from "./app-store/context";
import { initial, reducer } from "./app-store/reducer";
import { useRealtimeSync } from "./app-store/use-realtime";
import { listThreadsFor, withQueuedReplies } from "./app-store/selectors";
import { NO_MESSAGES, listState } from "./app-store/thread-filters";
import { memoLast, perSource } from "./app-store/memo-last";
import { useContactMerging } from "./app-store/use-contact-merging";
import { useDrafts } from "./app-store/use-drafts";
import { useOutbox } from "./app-store/use-outbox";
import { usePreDraft } from "./app-store/use-pre-draft";
import { useProfileDispatch } from "./app-store/use-profile-dispatch";
import { useTasks } from "./app-store/use-tasks";
import { useThreadActions } from "./app-store/use-thread-actions";
import { useThreadLoading } from "./app-store/use-thread-loading";
import { useUnsubscribes } from "./app-store/use-unsubscribes";

export type { DraftPhase } from "./app-store/context";
export type { ComposeDraft, ComposeDraftRequest, ComposeStatus, NewEmail } from "./app-store/compose";

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  // The user id, not the session: the session object changes on every hourly token refresh.
  const ready = session !== undefined;
  const userId = session?.user.id ?? null;
  const [state, rawDispatch] = useReducer(reducer, initial);
  const [drafting, setDrafting] = useState<Record<string, DraftPhase | undefined>>({});
  const [composeDrafts, setComposeDrafts] = useState<Record<string, ComposeDraft | undefined>>({});
  // New messages' drafts asked for here and still awaited; others (another tab) are not this tab's.
  const composeWaitRef = useRef(new Set<string>());
  // The draft each conversation is waiting on, so a timeout only gives up on a request still unanswered.
  const draftWaitRef = useRef<Record<string, string | undefined>>({});
  /** How many drafts were asked for in a conversation since its last reply, for how often people ask again. */
  const draftAskRef = useRef<Record<string, number | undefined>>({});
  const [hydrated, setHydrated] = useState(false);
  const [loadedThreadIds, setLoadedThreadIds] = useState<Set<string>>(new Set());
  const [failedThreadIds, setFailedThreadIds] = useState<Set<string>>(new Set());
  // Replies queued in the outbox, shown in the conversation until the sent email is imported.
  const [pending, setPending] = useState<PendingSend[]>([]);
  const [composed, setComposed] = useState<Record<string, ComposeStatus | undefined>>({});
  // Contacts merged away this session, to the contact each went into.
  const [mergedInto, setMergedInto] = useState<Record<string, string | undefined>>({});
  const [contactsVersion, setContactsVersion] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const loadedRef = useRef(loadedThreadIds);
  loadedRef.current = loadedThreadIds;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const composedRef = useRef(composed);
  composedRef.current = composed;
  // Conversations with older messages left to load, and loads in flight.
  const moreRef = useRef(new Map<string, boolean>());
  const loadingRef = useRef(new Map<string, Promise<void>>());
  const olderRef = useRef(new Set<string>());
  // Conversations with messages held, least recently used first, and the one on screen. Past a cap the oldest are dropped
  // (see recent-threads.ts), so a long session does not keep every conversation it ever opened.
  const heldRef = useRef<string[]>([]);
  const openRef = useRef<string | null>(null);
  const contactsForRef = useRef<string | null>(null);
  // Whether the store holds every contact (not just those in the listed threads): see contactsReady in the context.
  const [contactsReady, setContactsReady] = useState(false);
  // Failed tries at the deferred contacts load, which re-runs it after a pause.
  const [contactsTries, setContactsTries] = useState(0);

  const contactMap = useMemo(() => new Map(state.contacts.map((c) => [c.id, c])), [state.contacts]);
  const threadMap = useMemo(() => new Map(state.threads.map((t) => [t.id, t])), [state.threads]);
  const threadMapRef = useRef(threadMap);
  threadMapRef.current = threadMap;

  const { requestAutoDraft, schedulePreDraft } = usePreDraft({ userId, threadMapRef, stateRef });

  useEffect(() => { setHydrated(true); }, []);

  const notify = useCallback((text: string, undo?: () => void) => {
    toast(text, undo ? { action: { label: "Undo", onClick: undo } } : undefined);
  }, []);

  const saveFailed = useCallback(() => { toast("Could not save that change. Check your connection and try again."); }, []);

  // Load everything once signed in; clear on sign-out.
  useEffect(() => {
    if (!ready) return;
    if (!userId) {
      rawDispatch({ type: "clear" });
      setLoadedThreadIds(new Set());
      setPending([]);
      setComposed({});
      moreRef.current.clear();
      heldRef.current = [];
      openRef.current = null;
      contactsForRef.current = null;
      setContactsReady(false);
      return;
    }
    let cancelled = false;
    // Applied on top of whatever Realtime delivered while this loaded, with the state as it is now as the base for what changed meanwhile.
    const base = stateRef.current;
    loadEverything()
      .then((data) => {
        if (cancelled) return;
        rawDispatch({ type: "merged", base, data });
        if (data.contactsLoaded) { contactsForRef.current = userId; setContactsReady(true); }
        // Replies still queued or failed come back after a reload. Not required: the inbox works without them.
        loadOutbox().then((rows) => { if (!cancelled) setPending((p) => mergePending(p, rows)); }).catch(() => undefined);
      })
      .catch(() => {
        if (cancelled) return;
        rawDispatch({ type: "clear" });
        toast("Could not load your conversations.");
      });
    return () => { cancelled = true; };
  }, [ready, userId]);

  // The list arrives with every contact. Only when that part failed are they loaded here, with retries.
  useEffect(() => {
    if (state.loading || !userId || contactsForRef.current === userId) return;
    contactsForRef.current = userId;
    let done = false;
    const timer = setTimeout(() => {
      loadContacts()
        .then((contacts) => { if (!done) { rawDispatch({ type: "upsertContacts", contacts }); setContactsReady(true); } })
        .catch(() => {
          contactsForRef.current = null;
          if (done) return;
          if (contactsTries < 3) setTimeout(() => setContactsTries((n) => n + 1), 2000 * 2 ** contactsTries);
          else toast("Could not load all your contacts. Reload to try again.");
        })
        .finally(() => { done = true; });
    }, 0);
    return () => {
      clearTimeout(timer);
      if (!done) { done = true; contactsForRef.current = null; }
    };
  }, [state.loading, userId, contactsTries]);

  const { evictHeld, loadMessages, loadOlderMessages, hasOlder, prefetchMessages, ensureThread } = useThreadLoading({ rawDispatch, stateRef, threadMapRef, loadedRef, loadingRef, moreRef, olderRef, heldRef, openRef, setLoadedThreadIds, setFailedThreadIds });
  // Live updates: see app-store/use-realtime.ts.
  useRealtimeSync({ userId, schedulePreDraft, rawDispatch, stateRef, loadedRef, loadingRef, heldRef, openRef, evictHeld, moreRef, pendingRef, composedRef, threadMapRef, composeWaitRef, draftWaitRef, setComposeDrafts, setComposed, setDrafting, setPending });

  const { dispatch } = useProfileDispatch({ userId, rawDispatch, stateRef, saveFailed });

  // Map lookups, as rows and bubbles call these many times per render. A contact merged away this
  // session still resolves, to the contact it was merged into.
  const contactById = useCallback(
    (id: string) => contactMap.get(id) ?? (mergedInto[id] ? contactMap.get(followMerges(id, mergedInto)) : undefined),
    [contactMap, mergedInto],
  );
  const threadById = useCallback((id: string) => threadMap.get(id), [threadMap]);

  // Only search reads every loaded message, so the flat list is built on first read (a getter in the context value)
  // instead of copying them all on each realtime change to any one conversation.
  const flatMessages = useMemo(() => memoLast((byThread: typeof state.byThread) => Object.values(byThread).flat()), []);
  const messagesByThread = useMemo(() => withQueuedReplies(state.byThread, pending), [state.byThread, pending]);
  const messagesFor = useCallback((threadId: string) => messagesByThread.get(threadId) ?? NO_MESSAGES, [messagesByThread]);
  const messagesLoaded = useCallback((threadId: string) => loadedThreadIds.has(threadId), [loadedThreadIds]);
  const messagesFailed = useCallback((threadId: string) => failedThreadIds.has(threadId), [failedThreadIds]);

  // Filtered and sorted once per (view, filter) until the threads change. "Waiting" depends on the clock, so it is not cached.
  const listCache = useMemo(() => perSource((threads: Thread[], key: string) => listThreadsFor(threads, key)), []);
  const listThreads = useCallback(
    (view: View, filter: ListFilter) => listCache(state.threads, `${view}:${filter}`, filter !== "waiting"),
    [state.threads, listCache],
  );

  const { markRead, pin, archive, unarchive, trash, react, setJunk, giveFeedback } = useThreadActions({ userId, rawDispatch, stateRef, threadMapRef, notify, saveFailed });
  const { removePending, replyTo, setReplyTo, send, retryPending, composeEmail, composeWhatsApp, refreshCompose, saveSendAddresses } = useOutbox({ rawDispatch, stateRef, threadMapRef, pendingRef, draftAskRef, setPending, setComposed, saveFailed });
  const { generateDraft, generateComposeDraft, discardComposeDraft, discardDraft } = useDrafts({ userId, rawDispatch, threadMapRef, draftAskRef, draftWaitRef, composeWaitRef, setDrafting, setComposeDrafts, saveFailed });
  const { unsubscribe, confirmUnsubscribe } = useUnsubscribes({ rawDispatch, stateRef });
  const { refreshContacts, undoMerge, mergeContacts, splitContact, patchContact, removeContact, contactChanges, contactsRefreshed } = useContactMerging({ rawDispatch, stateRef, loadedRef, notify, setContactsReady, setContactsVersion, setMergedInto });
  const { tasks, tickTask, createTask, editTask, deleteTask } = useTasks({ userId, stored: state.tasks, rawDispatch, stateRef, saveFailed });

  // One value per change, so components that read the store redraw only when something changed.
  const value = useMemo<Ctx>(() => ({
    ...listState(state), dispatch, contactById, threadById, get messages() { return flatMessages(state.byThread); }, messagesByThread, messagesFor, messagesLoaded, messagesFailed,loadMessages, loadOlderMessages, hasOlder, removePending, retryPending, prefetchMessages,
    listThreads, notify, markRead, archive, unarchive, trash, pin, send, replyTo, setReplyTo, react, composeEmail, composeWhatsApp, composed, refreshCompose, ensureThread,
    saveSendAddresses, generateDraft, discardDraft, requestAutoDraft, generateComposeDraft, composeDrafts, discardComposeDraft, setJunk, unsubscribe, confirmUnsubscribe, drafting, hydrated, giveFeedback, mergeContacts, splitContact, undoMerge, refreshContacts, patchContact, removeContact, contactChanges, contactsRefreshed,
    contactsVersion, contactsReady, tasks, tickTask, createTask, editTask, deleteTask,
  }), [
    state, dispatch, contactById, threadById, flatMessages, messagesByThread, messagesFor, messagesLoaded, messagesFailed, loadMessages, loadOlderMessages, hasOlder, removePending, retryPending, prefetchMessages,
    listThreads, notify, markRead, archive, unarchive, trash, pin, send, replyTo, setReplyTo, react, composeEmail, composeWhatsApp, composed, refreshCompose, ensureThread,
    saveSendAddresses, generateDraft, discardDraft, requestAutoDraft, generateComposeDraft, composeDrafts, discardComposeDraft, setJunk, unsubscribe, confirmUnsubscribe, drafting, hydrated, giveFeedback, mergeContacts, splitContact, undoMerge, refreshContacts, patchContact, removeContact, contactChanges, contactsRefreshed,
    contactsVersion, contactsReady, tasks, tickTask, createTask, editTask, deleteTask,
  ]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/** The app store. Throws when used outside AppProvider. */
export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp outside provider");
  return ctx;
}
