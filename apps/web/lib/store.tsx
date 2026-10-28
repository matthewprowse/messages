"use client";

// The app store: AppProvider loads conversations, contacts and tasks, keeps them live, and exposes every action the
// screens call (read, archive, draft, send) through useApp. Helpers live in app-store/.


import { useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import type { Contact, Decision, Draft, ListFilter, Message, Task, Thread, ThreadStatus, View } from "./types";
import { useAuth } from "./auth";
import { supabase } from "./supabase";
import { pendingAttachments, type OutboxUpload } from "./outbox-files";
import { keepName, loadContactGraph, mergeContactsRpc, mergeErrorText, splitContactRpc, undoMergeRpc } from "./contact-merging";
import { followMerges } from "./merging";
import {loadContacts, loadEverything, loadThread, loadThreadMessages, mapUnsubscribe, messageSentAt, profilePatch, UNSUBSCRIBE_COLUMNS,
} from "./data";
import { isOverdue, isTempTask, taskOfWrite, taskWriteFields, tempTaskId, withTicks, type PendingTick, type TaskForm } from "./tasks";
import { seal, userKeys } from "./vault";
import { FIELD } from "@messages/crypto/fields";
import { addressIndex, ruleTargetIndex } from "@messages/crypto/addresses";
import { sealAddress } from "./address-refs";
import { track } from "./analytics";
import { wordOf } from "@messages/analytics";
import { draftEdit } from "@messages/analytics/draft";
import { ComposeDraft, ComposeDraftRequest, ComposeStatus, NewEmail, PendingSend, attachToOutbox, composeStatusOf } from "./app-store/compose";
import { AppContext, Ctx, DraftPhase } from "./app-store/context";
import { DRAFT_TIMEOUT_MS, PRE_DRAFT_QUIET_MS, VOICE_DRAFT_TIMEOUT_MS, mayPreDraft, uploadRecording } from "./app-store/draft-helpers";
import { Action, initial, reducer } from "./app-store/reducer";
import { useRealtimeSync } from "./app-store/use-realtime";
import { followTaskUpdate } from "./app-store/task-follow";
import { recordAction, recordCorrection } from "./app-store/telemetry";
import { MailAction, NO_MESSAGES, emailIds, inFilter, inView, isPriority, listState, rank, threadsIn } from "./app-store/thread-filters";

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
  const contactsForRef = useRef<string | null>(null);
  // Whether the store holds every contact (not just those in the listed threads): see contactsReady in the context.
  const [contactsReady, setContactsReady] = useState(false);
  // Failed tries at the deferred contacts load, which re-runs it after a pause.
  const [contactsTries, setContactsTries] = useState(0);

  const contactMap = useMemo(() => new Map(state.contacts.map((c) => [c.id, c])), [state.contacts]);
  const threadMap = useMemo(() => new Map(state.threads.map((t) => [t.id, t])), [state.threads]);
  const threadMapRef = useRef(threadMap);
  threadMapRef.current = threadMap;

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
      contactsForRef.current = null;
      setContactsReady(false);
      return;
    }
    let cancelled = false;
    loadEverything()
      .then((data) => {
        if (cancelled) return;
        rawDispatch({ type: "loaded", data });
        if (data.contactsLoaded) { contactsForRef.current = userId; setContactsReady(true); }
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

  // Live updates: see app-store/use-realtime.ts.
  useRealtimeSync({ userId, schedulePreDraft, rawDispatch, stateRef, loadedRef, loadingRef, moreRef, pendingRef, composedRef, threadMapRef, composeWaitRef, draftWaitRef, setComposeDrafts, setComposed, setDrafting, setPending });

  /**
   * Applies a change on screen straight away, then saves it. Components call dispatch as before;
   * the database writes live here.
   */
  const dispatch = useCallback((action: Action) => {
    if (!userId) return;
    switch (action.type) {
      case "addRule": {
        const rule = { ...action.rule, id: crypto.randomUUID() };
        track("feature_used", { feature: "priority_rule", detail: action.rule.kind });
        rawDispatch({ type: "addRule", rule });
        // Matched on the target's index, which is worked out here: the database cannot read the target.
        void userKeys()
          .then(async (keys) => ({ target: await sealAddress(rule.target), target_index: await ruleTargetIndex(keys, rule.target) }))
          .then((stored) => supabase.from("priority_rules").insert({ id: rule.id, user_id: userId, kind: rule.kind, ...stored }))
          .then(({ error }) => { if (error) { rawDispatch({ type: "removeRule", id: rule.id }); saveFailed(); } }, () => { rawDispatch({ type: "removeRule", id: rule.id }); saveFailed(); });
        return;
      }
      case "removeRule":
        rawDispatch(action);
        supabase.from("priority_rules").delete().eq("id", action.id).then(({ error }) => { if (error) saveFailed(); });
        return;
      case "addExample": {
        const example = { ...action.example, id: crypto.randomUUID() };
        rawDispatch({ type: "addExample", example });
        // The situation and the text are sealed in the browser (fields writingSituation and writingBody).
        void Promise.all([seal(FIELD.writingSituation, example.context), seal(FIELD.writingBody, example.text)])
          .then(([situation, body]) => supabase.from("writing_examples").insert({ id: example.id, user_id: userId, situation, body }))
          .then(({ error }) => { if (error) { rawDispatch({ type: "removeExample", id: example.id }); saveFailed(); } }, () => { rawDispatch({ type: "removeExample", id: example.id }); saveFailed(); });
        return;
      }
      case "removeExample":
        rawDispatch(action);
        supabase.from("writing_examples").delete().eq("id", action.id).then(({ error }) => { if (error) saveFailed(); });
        return;
      case "patchProfile":
        // Which settings changed, never their values.
        for (const key of Object.keys(action.patch)) {
          const setting = wordOf(key);
          if (setting) track("setting_changed", { setting });
        }
        rawDispatch(action);
        supabase.from("profiles").upsert({ user_id: userId, ...profilePatch(action.patch) }, { onConflict: "user_id" })
          .then(({ error }) => { if (error) saveFailed(); });
        return;
      case "patchAccount":
        rawDispatch(action);
        if (action.patch.nickname !== undefined) {
          supabase.from("accounts").update({ nickname: action.patch.nickname || null }).eq("id", action.id).then(({ error }) => { if (error) saveFailed(); });
        }
        if (action.patch.status === "disconnected") {
          // The sync worker notices within 30 seconds and stops that account.
          supabase.from("accounts").update({ status: "disconnected" }).eq("id", action.id).then(({ error }) => { if (error) saveFailed(); });
        }
        return;
      case "reset":
        toast("Not available yet.");
        return;
      default:
        rawDispatch(action);
    }
  }, [userId, saveFailed]);

  // Map lookups, as rows and bubbles call these many times per render. A contact merged away this
  // session still resolves, to the contact it was merged into.
  const contactById = useCallback(
    (id: string) => contactMap.get(id) ?? (mergedInto[id] ? contactMap.get(followMerges(id, mergedInto)) : undefined),
    [contactMap, mergedInto],
  );
  const threadById = useCallback((id: string) => threadMap.get(id), [threadMap]);

  const messages = useMemo(() => Object.values(state.byThread).flat(), [state.byThread]);
  // Queued replies follow the stored messages. A conversation without any keeps its stored list as is.
  const messagesByThread = useMemo(() => {
    const queued = new Map<string, Message[]>();
    for (const p of pending) {
      const m: Message = {
        id: `outbox:${p.id}`,
        threadId: p.threadId,
        from: "me",
        sentAt: p.createdAt,
        body: p.body,
        attachments: p.attachments,
        sendState: p.status === "failed" ? "failed" : "sending",
        sendError: p.error,
      };
      queued.set(p.threadId, [...(queued.get(p.threadId) ?? []), m]);
    }
    const out = new Map(Object.entries(state.byThread));
    for (const [threadId, list] of queued) out.set(threadId, [...(out.get(threadId) ?? []), ...list]);
    return out;
  }, [state.byThread, pending]);
  const messagesFor = useCallback((threadId: string) => messagesByThread.get(threadId) ?? NO_MESSAGES, [messagesByThread]);
  const messagesLoaded = useCallback((threadId: string) => loadedThreadIds.has(threadId), [loadedThreadIds]);

  const loadMessages = useCallback((threadId: string, aroundMessageId?: string) => {
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
        setLoadedThreadIds((prev) => (prev.has(threadId) ? prev : new Set(prev).add(threadId)));
      } catch {
        toast("Could not load this conversation.");
      } finally {
        loadingRef.current.delete(key);
      }
    })();
    loadingRef.current.set(key, task);
    return task;
  }, []);

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

  // A failed send you have deleted, or retried as a new send: it leaves the conversation for good.
  const removePending = useCallback((outboxId: string) => setPending((p) => p.filter((x) => x.id !== outboxId)), []);

  const prefetchMessages = useCallback((threadId: string) => {
    if (!loadedRef.current.has(threadId)) void loadMessages(threadId);
  }, [loadMessages]);

  const listThreads = useCallback(
    (view: View, filter: ListFilter) =>
      state.threads
        .filter((t) => t.status === "inbox" && inView(t, view) && (view !== "priority" || isPriority(t)) && inFilter(t, filter))
        .sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
          if (view === "priority" && rank[a.priority] !== rank[b.priority]) return rank[a.priority] - rank[b.priority];
          return b.lastMessageAt.localeCompare(a.lastMessageAt);
        }),
    [state.threads],
  );

  // Changes the mail server should know about are queued for the sync worker, which applies them there.
  const queueMailAction = useCallback((threadId: string | string[], action: MailAction) => {
    const ids = Array.isArray(threadId) ? threadId : [threadId];
    if (ids.length === 0) return;
    supabase.from("mail_actions").insert(ids.map((thread_id) => ({ thread_id, action }))).then(({ error }) => { if (error) saveFailed(); });
  }, [saveFailed]);

  // Read state is saved here and sent back to the mail server.
  const markRead = useCallback((id: string, read: boolean, opened = false) => {
    const prev = threadMapRef.current.get(id);
    if (prev && !opened && prev.unread === read) recordAction([prev], read ? "read" : "unread");
    const unreadCount = read ? 0 : Math.max(1, prev?.unreadCount ?? 0);
    rawDispatch({ type: "patchThread", id, patch: { unread: !read, unreadCount } });
    if (prev?.channel === "email") queueMailAction(id, read ? "read" : "unread");
    // WhatsApp read receipts only ever follow opening the chat; the worker checks the Settings switch.
    else if (prev?.channel === "whatsapp" && read && opened) queueMailAction(id, "read");
    // A Teams chat is marked read in Teams only when you open it here, never by Mark as Read.
    else if (prev?.channel === "teams" && read && opened) queueMailAction(id, "read");
    // Instagram is told you saw a thread only when you open it here.
    else if (prev?.channel === "instagram" && read && opened) queueMailAction(id, "read");
    (async () => {
      if (read) {
        const [a, b] = await Promise.all([
          supabase.from("messages").update({ is_read: true }).eq("thread_id", id).eq("is_read", false),
          supabase.from("threads").update({ unread_count: 0 }).eq("id", id),
        ]);
        if (a.error || b.error) saveFailed();
      } else {
        const latest = await supabase.from("messages").select("id").eq("thread_id", id).eq("direction", "inbound")
          .order("sent_at", { ascending: false }).limit(1).maybeSingle();
        if (latest.data) await supabase.from("messages").update({ is_read: false }).eq("id", latest.data.id);
        const b = await supabase.from("threads").update({ unread_count: unreadCount }).eq("id", id);
        if (latest.error || b.error) saveFailed();
      }
    })();
  }, [saveFailed, queueMailAction]);

  const pin = useCallback((id: string, pinned: boolean) => {
    const before = threadMapRef.current.get(id);
    if (before) recordAction([before], pinned ? "pin" : "unpin");
    rawDispatch({ type: "patchThread", id, patch: { pinned } });
    supabase.from("threads").update({ pinned }).eq("id", id).then(({ error }) => { if (error) saveFailed(); });
  }, [saveFailed]);

  const saveStatus = useCallback((ids: string[], status: ThreadStatus) => {
    if (ids.length === 0) return;
    rawDispatch({ type: "patchThreads", ids, patch: { status } });
    supabase.from("threads").update({ status }).in("id", ids).then(({ error }) => { if (error) saveFailed(); });
  }, [saveFailed]);

  // Undo puts each conversation back where it was.
  const restoreStatus = useCallback((before: Thread[]) => {
    for (const status of new Set(before.map((t) => t.status))) saveStatus(before.filter((t) => t.status === status).map((t) => t.id), status);
  }, [saveStatus]);

  const archive = useCallback((ids: string | string[]) => {
    const before = threadsIn(stateRef.current.threads, ids).filter((t) => t.status !== "archived");
    if (before.length === 0) return;
    recordAction(before, "archive");
    saveStatus(before.map((t) => t.id), "archived");
    queueMailAction(emailIds(before), "archive");
    notify(before.length === 1 ? "Archived" : `Archived ${before.length} conversations`, () => {
      restoreStatus(before);
      queueMailAction(emailIds(before.filter((t) => t.status === "inbox")), "unarchive");
    });
  }, [notify, saveStatus, restoreStatus, queueMailAction]);

  // Delete moves email to the provider's Bin, so Undo, or the provider itself, can bring it back.
  const trash = useCallback((ids: string | string[]) => {
    const before = threadsIn(stateRef.current.threads, ids).filter((t) => t.status !== "trash");
    if (before.length === 0) return;
    recordAction(before, "trash");
    saveStatus(before.map((t) => t.id), "trash");
    queueMailAction(emailIds(before), "trash");
    notify(before.length === 1 ? "Deleted" : `Deleted ${before.length} conversations`, () => {
      restoreStatus(before);
      queueMailAction(emailIds(before), "untrash");
    });
  }, [notify, saveStatus, restoreStatus, queueMailAction]);

  const [replyTo, setReplyToState] = useState<Record<string, Message | undefined>>({});
  const replyToRef = useRef(replyTo);
  replyToRef.current = replyTo;
  const setReplyTo = useCallback((threadId: string, message: Message | null) => {
    setReplyToState((r) => ({ ...r, [threadId]: message ?? undefined }));
  }, []);

  const send = useCallback(async (threadId: string, body: string, fromAddress?: string, files: OutboxUpload[] = [], standalone = false, copies?: { to: string[]; cc: string[] }) => {
    // A reply that started as an AI draft keeps the link, so the AI can learn from what you changed.
    const draftId = standalone ? null : threadMapRef.current.get(threadId)?.draft?.id ?? null;
    const replyToId = standalone ? null : replyToRef.current[threadId]?.id ?? null;
    const sealed = await seal(FIELD.body, body).catch(() => null);
    // Addresses are sealed like the body: a failed key request is a failed send, not an unhandled rejection.
    const addresses = sealed === null ? null : await Promise.all([
      fromAddress ? sealAddress(fromAddress) : Promise.resolve(null),
      copies ? Promise.all(copies.to.map((a) => sealAddress(a))) : Promise.resolve(null),
      copies ? Promise.all(copies.cc.map((a) => sealAddress(a))) : Promise.resolve(null),
    ]).catch(() => null);
    const { data, error } = sealed === null || addresses === null ? { data: null, error: true } : await supabase.from("outbox")
      .insert({ thread_id: threadId, body: sealed, draft_id: draftId, from_address: addresses[0], reply_to_message_id: replyToId, attachment_count: files.length,
        // Reply All: the worker sends to exactly these. Sealed like any address.
        ...(copies ? { to_addresses: addresses[1] ?? [], cc_addresses: addresses[2] ?? [] } : {}) })
      .select("id, created_at").single();
    if (error || !data) {
      toast("Could not send. Your reply is still in the box.");
      return false;
    }
    if (!(await attachToOutbox(data.id, files).catch(() => false))) {
      toast("Could not attach the files. Your reply is still in the box.");
      return false;
    }
    const attachments = files.length ? pendingAttachments(files) : undefined;
    if (!standalone) {
      const t = threadMapRef.current.get(threadId);
      if (t) {
        const hours = t.lastFromMe ? 0 : Math.round(Math.max(0, (Date.now() - Date.parse(t.lastMessageAt)) / 3_600_000));
        track("reply_sent", { channel: t.channel, was_needs_reply: t.needsReply, priority: t.priority, category: t.category, hours_to_reply: hours });
        const draft = t.draft;
        if (draft && draftId) {
          const asked = draftAskRef.current[threadId];
          track("draft_sent", {
            ...draftEdit(draft.body, body),
            channel: t.channel,
            tone: draft.tone,
            secs_to_send: Math.round(Math.max(0, (Date.now() - Date.parse(draft.generatedAt)) / 1000)),
            regenerated: Math.max(0, (asked ?? 1) - 1),
            auto: !!draft.auto,
          });
          delete draftAskRef.current[threadId];
        }
      }
    }
    setPending((p) => [...p, { id: data.id, threadId, body, createdAt: data.created_at, status: "queued", attachments }]);
    if (draftId) rawDispatch({ type: "setDraft", id: threadId });
    if (replyToId) setReplyTo(threadId, null);
    return true;
  }, [setReplyTo]);

  // Shown at once; the worker sends it over WhatsApp and the stored message then matches.
  const react = useCallback((message: Message, emoji: string) => {
    const reactions = { ...(message.reactions ?? {}) };
    if (emoji) reactions.me = emoji;
    else delete reactions.me;
    rawDispatch({ type: "replaceMessage", message: { ...message, reactions: Object.keys(reactions).length ? reactions : undefined } });
    supabase.from("mail_actions").insert({ thread_id: message.threadId, action: "react", message_id: message.id, emoji }).then(({ error }) => {
      if (!error) return;
      // Only your own reaction goes back: other people's may have changed since.
      const now = stateRef.current.byThread[message.threadId]?.find((m) => m.id === message.id) ?? message;
      const back = { ...(now.reactions ?? {}) };
      if (message.reactions?.me) back.me = message.reactions.me;
      else delete back.me;
      rawDispatch({ type: "replaceMessage", message: { ...now, reactions: Object.keys(back).length ? back : undefined } });
      saveFailed();
    });
  }, [saveFailed]);

  // A new email has no conversation yet. The worker sets thread_id once the sent copy is stored.
  const composeEmail = useCallback(async (email: NewEmail) => {
    const files = email.files ?? [];
    // Sealing and address sealing can fail on a transient key error: that is a failed send, not a crash.
    const sealed = await Promise.all([seal(FIELD.subject, email.subject.trim() || null), seal(FIELD.body, email.body)]).catch(() => null);
    const addresses = sealed === null ? null : await Promise.all([
      email.fromAddress ? sealAddress(email.fromAddress) : Promise.resolve(email.fromAddress),
      Promise.all(email.to.map((a) => sealAddress(a))),
      Promise.all((email.cc ?? []).map((a) => sealAddress(a))),
      Promise.all((email.bcc ?? []).map((a) => sealAddress(a))),
    ]).catch(() => null);
    const { data, error } = sealed === null || addresses === null ? { data: null, error: true } : await supabase.from("outbox")
      .insert({
        account_id: email.accountId,
        from_address: addresses[0],
        to_addresses: addresses[1],
        cc_addresses: addresses[2],
        bcc_addresses: addresses[3],
        subject: sealed[0],
        body: sealed[1],
        attachment_count: files.length,
        draft_id: email.draftId ?? null,
      })
      .select("id").single();
    if (error || !data) {
      toast("Could not send. Your email is still in the box.");
      return null;
    }
    if (!(await attachToOutbox(data.id, files).catch(() => false))) {
      toast("Could not attach the files. Your email is still in the box.");
      return null;
    }
    setComposed((c) => ({ ...c, [data.id]: { status: "queued" } }));
    return data.id;
  }, []);

  // A new WhatsApp chat: one number, no subject or From address. The worker sets thread_id once it is sent.
  const composeWhatsApp = useCallback(async (accountId: string, to: string, body: string, draftId?: string) => {
    const sealed = await seal(FIELD.body, body).catch(() => null);
    const sealedTo = await sealAddress(to).catch(() => null);
    const { data, error } = sealed === null || sealedTo === null ? { data: null, error: true } : await supabase.from("outbox")
      .insert({ account_id: accountId, to_addresses: [sealedTo], body: sealed, attachment_count: 0, draft_id: draftId ?? null })
      .select("id").single();
    if (error || !data) {
      toast("Could not send. Your message is still in the box.");
      return null;
    }
    setComposed((c) => ({ ...c, [data.id]: { status: "queued" } }));
    return data.id;
  }, []);

  const refreshCompose = useCallback(async (outboxId: string) => {
    const { data } = await supabase.from("outbox").select("status, thread_id, error").eq("id", outboxId).maybeSingle();
    if (data) setComposed((c) => ({ ...c, [outboxId]: composeStatusOf(data) }));
  }, []);

  const ensureThread = useCallback(async (threadId: string) => {
    if (threadMapRef.current.has(threadId)) return true;
    const loaded = await loadThread(threadId).catch(() => null);
    if (!loaded) return false;
    rawDispatch({ type: "upsertContacts", contacts: loaded.contacts });
    rawDispatch({ type: "upsertThread", thread: loaded.thread });
    return true;
  }, []);

  // Only send_addresses is writable by the app; the database lowercases and dedupes the list.
  const saveSendAddresses = useCallback(async (accountId: string, addresses: string[]) => {
    const before = stateRef.current.accounts.find((a) => a.id === accountId)?.sendAddresses ?? [];
    rawDispatch({ type: "patchAccount", id: accountId, patch: { sendAddresses: addresses } });
    const unique = [...new Set(addresses.map((a) => a.trim().toLowerCase()).filter(Boolean))];
    const { error } = await supabase.from("accounts").update({ send_addresses: await Promise.all(unique.map((a) => sealAddress(a))) }).eq("id", accountId);
    if (error) {
      rawDispatch({ type: "patchAccount", id: accountId, patch: { sendAddresses: before } });
      saveFailed();
      return false;
    }
    return true;
  }, [saveFailed]);

  // The AI worker writes the draft; it arrives through Realtime, usually within a few seconds. One that
  // has not arrived after DRAFT_TIMEOUT_MS is given up on, so the composer never waits forever.
  const generateDraft = useCallback(async (threadId: string, tone: Draft["tone"] = "default", instruction?: string, decision?: Decision, source?: string, audio?: Blob) => {
    if (!userId) return;
    const asking = threadMapRef.current.get(threadId);
    draftAskRef.current[threadId] = (draftAskRef.current[threadId] ?? 0) + 1;
    if (asking) track("draft_requested", { tone, source: decision ? "choice" : "manual", channel: asking.channel, has_instruction: !!instruction?.trim() || !!audio, revises: source !== undefined, via: audio ? "voice" : instruction?.trim() ? "typed" : undefined });
    setDrafting((d) => ({ ...d, [threadId]: "thinking" }));
    // A recording goes up sealed with your key first; the worker deletes it once the draft is written.
    const audioPath = audio ? await uploadRecording(userId, audio) : undefined;
    if (audio && !audioPath) {
      setDrafting((d) => ({ ...d, [threadId]: undefined }));
      toast("Could not send the recording. Check your connection and try again.");
      return;
    }
    const { data, error } = await supabase
      .from("drafts")
      .insert({
        user_id: userId, thread_id: threadId, tone, instruction: await seal(FIELD.instruction, instruction?.trim() || null), status: "pending",
        // Only sent with a choice, so drafts keep working where the decision columns are not there yet.
        ...(decision ? { decision: await seal(FIELD.instruction, decision.text), decision_kind: decision.kind } : {}),
        ...(source !== undefined ? { source: await seal(FIELD.draft, source) } : {}),
        ...(audioPath ? { audio_path: audioPath } : {}),
      })
      .select("id")
      .single();
    if (error || !data) {
      if (audioPath) void supabase.storage.from("attachments").remove([audioPath]).then(() => undefined);
      setDrafting((d) => ({ ...d, [threadId]: undefined }));
      toast(tone === "edit" ? "Could not ask for an edit. Check your connection and try again." : "Could not ask for a draft. Check your connection and try again.");
      return;
    }
    draftWaitRef.current[threadId] = data.id;
    setTimeout(() => {
      if (draftWaitRef.current[threadId] !== data.id) return;
      delete draftWaitRef.current[threadId];
      setDrafting((d) => ({ ...d, [threadId]: undefined }));
      toast(tone === "edit" ? "The edit took too long. Try again." : "The draft took too long. Try again.");
      // Withdrawn, so the AI worker does not pick it up later. A Supabase query only runs once awaited.
      void supabase.from("drafts").update({ status: "discarded" }).eq("id", data.id).eq("status", "pending").then(() => undefined);
      if (audioPath) void supabase.storage.from("attachments").remove([audioPath]).then(() => undefined);
    }, audio ? VOICE_DRAFT_TIMEOUT_MS : DRAFT_TIMEOUT_MS);
  }, [userId]);

  // A new message's draft: the same pending row and AI worker, with no conversation. It comes back
  // through Realtime into composeDrafts; one not back after the timeout is given up on and withdrawn.
  const generateComposeDraft = useCallback(async (req: ComposeDraftRequest) => {
    if (!userId) return null;
    const tone = req.tone ?? "custom";
    const instruction = req.instruction?.trim() || undefined;
    track("draft_requested", { tone, source: "compose", channel: req.channel, has_instruction: !!instruction || !!req.audio, revises: req.source !== undefined, via: req.audio ? "voice" : instruction ? "typed" : undefined });
    const audioPath = req.audio ? await uploadRecording(userId, req.audio) : undefined;
    if (req.audio && !audioPath) {
      toast("Could not send the recording. Check your connection and try again.");
      return null;
    }
    const { data, error } = await supabase
      .from("drafts")
      .insert({
        user_id: userId, thread_id: null, account_id: req.accountId, contact_id: req.contactId ?? null, tone, status: "pending",
        instruction: await seal(FIELD.instruction, instruction ?? null),
        ...(req.source !== undefined ? { source: await seal(FIELD.draft, req.source) } : {}),
        ...(audioPath ? { audio_path: audioPath } : {}),
      })
      .select("id")
      .single();
    if (error || !data) {
      if (audioPath) void supabase.storage.from("attachments").remove([audioPath]).then(() => undefined);
      toast("Could not ask for a draft. Check your connection and try again.");
      return null;
    }
    composeWaitRef.current.add(data.id);
    setComposeDrafts((c) => ({ ...c, [data.id]: { status: "pending" } }));
    setTimeout(() => {
      if (!composeWaitRef.current.delete(data.id)) return;
      setComposeDrafts((c) => ({ ...c, [data.id]: { status: "failed", error: "The draft took too long. Try again." } }));
      void supabase.from("drafts").update({ status: "discarded" }).eq("id", data.id).eq("status", "pending").then(() => undefined);
      if (audioPath) void supabase.storage.from("attachments").remove([audioPath]).then(() => undefined);
    }, req.audio ? VOICE_DRAFT_TIMEOUT_MS : DRAFT_TIMEOUT_MS);
    return data.id;
  }, [userId]);

  const discardComposeDraft = useCallback((id: string, status: "discarded" | "revised" = "discarded") => {
    composeWaitRef.current.delete(id);
    setComposeDrafts((c) => { const next = { ...c }; delete next[id]; return next; });
    void supabase.from("drafts").update({ status }).eq("id", id).in("status", ["pending", "active"]).then(() => undefined);
  }, []);

  const discardDraft = useCallback((threadId: string) => {
    const t = threadMapRef.current.get(threadId);
    const draft = t?.draft;
    if (t && draft) track("draft_discarded", { channel: t.channel, tone: draft.tone, secs: Math.round(Math.max(0, (Date.now() - Date.parse(draft.generatedAt)) / 1000)), auto: !!draft.auto });
    rawDispatch({ type: "setDraft", id: threadId });
    if (draft) supabase.from("drafts").update({ status: "discarded" }).eq("id", draft.id).then(({ error }) => { if (error) saveFailed(); });
  }, [saveFailed]);

  // Junk you choose yourself also goes to the provider's spam; junk the AI sorts out stays where it is there.
  const setJunk = useCallback((threadIds: string | string[], junk: boolean) => {
    if (!userId) return;
    const before = threadsIn(stateRef.current.threads, threadIds).filter((t) => t.junk !== junk);
    if (before.length === 0) return;
    const ids = before.map((t) => t.id);
    recordAction(before, junk ? "junk" : "not_junk");
    for (const t of before.slice(0, 3)) recordCorrection(t.id, "junk", t.junk ? "junk" : "not_junk", junk ? "junk" : "not_junk");
    const feedbackIds = ids.map(() => crypto.randomUUID());
    const save = (value: boolean) => {
      rawDispatch({ type: "patchThreads", ids, patch: { junk: value } });
      return supabase.from("threads").update({ junk: value }).in("id", ids);
    };
    Promise.all([
      save(junk),
      supabase.from("feedback").insert(ids.map((thread_id, i) => ({ id: feedbackIds[i], user_id: userId, thread_id, value: junk ? "junk" : "not_junk" }))),
    ]).then((results) => { if (results.some((r) => r.error)) saveFailed(); });
    queueMailAction(emailIds(before), junk ? "spam" : "unspam");
    const n = before.length;
    const text = junk ? (n === 1 ? "Moved to Junk" : `Moved ${n} conversations to Junk`) : n === 1 ? "Moved out of Junk" : `Moved ${n} conversations out of Junk`;
    notify(text, () => {
      // The correction is taken back too, so the AI does not learn from it.
      Promise.all([save(!junk), supabase.from("feedback").delete().in("id", feedbackIds)])
        .then((results) => { if (results.some((r) => r.error)) saveFailed(); });
      queueMailAction(emailIds(before), junk ? "unspam" : "spam");
    });
  }, [userId, notify, saveFailed, queueMailAction]);

  const unsubscribe = useCallback(async (senders: { accountId: string; sender: string }[]) => {
    const existing = new Map(stateRef.current.unsubscribes.map((u) => [`${u.accountId}|${u.sender}`, u]));
    // Senders are queued at once rather than one after another. Returns true when the sender is queued.
    const queueOne = async (s: { accountId: string; sender: string }) => {
      const previous = existing.get(`${s.accountId}|${s.sender}`);
      if (previous && previous.status !== "failed" && previous.status !== "manual") return true; // already on its way
      if (previous) {
        // A failed or manual attempt is cleared first so the sender can be tried again.
        await supabase.from("unsubscribes").delete().eq("id", previous.id);
        rawDispatch({ type: "removeUnsubscribe", id: previous.id });
      }
      // With the sender's index, which the database matches on (and which keeps a sender to one row).
      const stored = { sender_address: await sealAddress(s.sender), sender_index: await addressIndex(await userKeys(), s.sender) };
      const { data, error } = await supabase.from("unsubscribes").insert({ account_id: s.accountId, ...stored }).select(UNSUBSCRIBE_COLUMNS).single();
      if (error || !data) return false;
      rawDispatch({ type: "upsertUnsubscribe", unsubscribe: { ...mapUnsubscribe(data), sender: s.sender } });
      return true;
    };
    const results = await Promise.all(senders.map(queueOne));
    const queued = results.filter(Boolean).length;
    if (queued < senders.length) toast("Some senders could not be queued. Try again.");
    return queued;
  }, []);

  // "I've Unsubscribed" is easy to press by mistake, so it shows at once but is only saved once this long has
  // passed without Undo. Closing the page in that time saves nothing, and the sender stays to do.
  const CONFIRM_UNSUBSCRIBE_MS = 6000;
  const confirmUnsubscribe = useCallback((id: string) => {
    const before = stateRef.current.unsubscribes.find((u) => u.id === id);
    if (!before || before.status !== "manual") return;
    rawDispatch({ type: "upsertUnsubscribe", unsubscribe: { ...before, status: "done" } });
    const timer = setTimeout(() => {
      void supabase.rpc("confirm_unsubscribe", { p_id: id }).then(({ error }) => {
        if (!error) return;
        rawDispatch({ type: "upsertUnsubscribe", unsubscribe: before });
        toast("Could not mark it as unsubscribed. Try again.");
      });
    }, CONFIRM_UNSUBSCRIBE_MS);
    toast("Marked as unsubscribed", {
      duration: CONFIRM_UNSUBSCRIBE_MS,
      action: { label: "Undo", onClick: () => { clearTimeout(timer); rawDispatch({ type: "upsertUnsubscribe", unsubscribe: before }); } },
    });
  }, []);

  const giveFeedback = useCallback((id: string, value: "important" | "not_important") => {
    if (!userId) return;
    const priority = value === "important" ? "important" : "low";
    const before = threadMapRef.current.get(id);
    if (before) recordCorrection(id, "priority", before.priority, priority);
    rawDispatch({ type: "feedback", id, value });
    Promise.all([
      supabase.from("feedback").insert({ user_id: userId, thread_id: id, value }),
      supabase.from("threads").update({ priority }).eq("id", id),
    ]).then((results) => { if (results.some((r) => r.error)) saveFailed(); });
    notify(value === "important" ? "Marked as important" : "Marked as not important");
  }, [userId, notify, saveFailed]);

  // After a merge, split or undo: every contact and conversation member again, and the open
  // conversations whose senders or members changed.
  const refreshContacts = useCallback(async (affected: string[]) => {
    // The change is already saved, so the Contacts lists reload straight away, from the database until the store has caught up.
    setContactsReady(false);
    setContactsVersion((v) => v + 1);
    let contacts: Contact[] = stateRef.current.contacts;
    try {
      const graph = await loadContactGraph();
      contacts = graph.contacts;
      const ids = new Set(affected);
      const threadIds = new Set<string>();
      for (const [threadId, list] of Object.entries(stateRef.current.byThread)) if (loadedRef.current.has(threadId) && list.some((m) => ids.has(m.from))) threadIds.add(threadId);
      for (const [threadId, members] of graph.participants) if (loadedRef.current.has(threadId) && members.some((id) => ids.has(id))) threadIds.add(threadId);
      rawDispatch({ type: "setContactGraph", contacts: graph.contacts, participants: graph.participants });
      setContactsReady(true);
      // Everything already loaded is fetched again for its new senders, keeping older pages and jumps.
      await Promise.all([...threadIds].map(async (threadId) => {
        const oldest = stateRef.current.byThread[threadId]?.[0];
        if (!oldest) return;
        const page = await loadThreadMessages(threadId, { from: oldest.sentAt });
        rawDispatch({ type: "mergeMessages", threadId, messages: page.messages });
      }));
    } catch {
      toast("Could not refresh your contacts. Reload to see the change.");
    }
    return contacts;
  }, []);

  const undoMerge = useCallback(async (mergeId: string) => {
    const { error, keptId, mergedId } = await undoMergeRpc(mergeId);
    if (error) {
      toast(mergeErrorText(error, "Could not undo the merge. Check your connection and try again."));
      return false;
    }
    if (mergedId) setMergedInto((m) => ({ ...m, [mergedId]: undefined }));
    await refreshContacts([keptId, mergedId].filter((id): id is string => !!id));
    toast("Merge undone");
    return true;
  }, [refreshContacts]);

  const mergeContacts = useCallback(async (keepId: string, mergeId: string, reason: "suggestion" | "manual", name?: string) => {
    const { data, error } = await mergeContactsRpc(keepId, mergeId, reason);
    if (error || !data) {
      toast(mergeErrorText(error, "Could not merge these contacts. Check your connection and try again."));
      return null;
    }
    track("feature_used", { feature: "merge_contacts", detail: reason });
    if (name) await keepName(keepId, name).catch(() => { toast("Merged, but could not keep the name you chose."); });
    setMergedInto((m) => ({ ...m, [mergeId]: keepId }));
    const contacts = await refreshContacts([keepId, mergeId]);
    const kept = contacts.find((c) => c.id === keepId)?.name ?? name;
    notify(kept ? `Merged into ${kept}` : "Merged", () => { void undoMerge(data); });
    return data;
  }, [refreshContacts, notify, undoMerge]);

  const splitContact = useCallback(async (contactId: string, identityIds: string[], name: string) => {
    const { data, error } = await splitContactRpc(contactId, identityIds, name);
    if (error || !data) {
      toast(mergeErrorText(error, "Could not split this contact. Check your connection and try again."));
      return null;
    }
    track("feature_used", { feature: "split_contact" });
    await refreshContacts([contactId, data]);
    return data;
  }, [refreshContacts]);

  // Ticks waiting on the worker, by task, laid over the tasks until each settles.
  const [ticks, setTicks] = useState<Record<string, PendingTick | undefined>>({});
  const ticksRef = useRef(ticks);
  ticksRef.current = ticks;
  const tasks = useMemo(() => withTicks(state.tasks, ticks), [state.tasks, ticks]);
  useEffect(() => { setTicks({}); }, [userId]);

  const tickTask = useCallback((task: Task, done: boolean, via: "calendar" | "details" | "summary") => {
    if (!userId) return;
    const action = done ? "complete" : "reopen";
    const provider = stateRef.current.accounts.find((a) => a.id === task.accountId)?.provider ?? "unknown";
    track("task_ticked", { action, provider, overdue: isOverdue(task), timed: !!task.dueAt && !task.dueAllDay, via });
    const temp = `tick-${crypto.randomUUID()}`;
    setTicks((t) => ({ ...t, [task.id]: { token: temp, done } }));
    // A tick is dropped by its own result only while it is the latest for its task, so an earlier one settling leaves the newer showing.
    const drop = (token: string) => setTicks((t) => (t[task.id]?.token === token ? { ...t, [task.id]: undefined } : t));
    void (async () => {
      const { data, error } = await supabase.from("task_updates").insert({ task_id: task.id, action }).select("id").single();
      if (error || !data) {
        drop(temp);
        saveFailed();
        return;
      }
      setTicks((t) => (t[task.id]?.token === temp ? { ...t, [task.id]: { token: data.id, done } } : t));
      const result = await followTaskUpdate(data.id);
      // The task as the worker left it, in case its own Realtime update is slow or missed.
      if (result.status === "done" && ticksRef.current[task.id]?.token === data.id) {
        rawDispatch({ type: "patchTask", id: task.id, patch: { completed: done, completedAt: done ? new Date().toISOString() : undefined } });
      }
      if (result.status === "failed") toast(result.error ?? (done ? "The task could not be ticked off." : "The task could not be reopened."));
      drop(data.id);
    })();
  }, [userId, saveFailed]);

  // Tasks made, changed and deleted here go through the same queue as a tick. Title and notes are sealed before the row is stored.
  const queueTaskWrite = useCallback(async (row: { action: "create" | "update" | "delete"; task_id?: string; account_id?: string }, write?: ReturnType<typeof taskWriteFields>) => {
    const sealed = write ? await Promise.all([seal(FIELD.taskTitle, write.title), seal(FIELD.taskNotes, write.notes)]).catch(() => null) : undefined;
    if (write && !sealed) return null;
    const { data, error } = await supabase
      .from("task_updates")
      .insert({ ...row, ...(write && sealed ? { title: sealed[0], notes: sealed[1], due_at: write.due_at, due_all_day: write.due_all_day, priority: write.priority } : {}) })
      .select("id")
      .single();
    return error || !data ? null : data.id;
  }, []);

  const createTask = useCallback((form: TaskForm) => {
    if (!userId) return;
    const provider = stateRef.current.accounts.find((a) => a.id === form.accountId)?.provider;
    const write = taskWriteFields(form, provider);
    const temp = tempTaskId();
    rawDispatch({ type: "upsertTask", task: taskOfWrite(temp, form.accountId, write) });
    void (async () => {
      const id = await queueTaskWrite({ action: "create", account_id: form.accountId }, write);
      if (!id) {
        rawDispatch({ type: "removeTask", id: temp });
        saveFailed();
        return;
      }
      const result = await followTaskUpdate(id, 60_000, 2000, "Creating the task is taking too long. Check that the worker is running.");
      // The worker has stored the real task by now (its Realtime insert replaces this one); on failure it never will.
      rawDispatch({ type: "removeTask", id: temp });
      toast(result.status === "failed" ? (result.error ?? "The task could not be created.") : "Task created.");
    })();
  }, [userId, saveFailed, queueTaskWrite]);

  const editTask = useCallback((task: Task, form: TaskForm) => {
    if (!userId || isTempTask(task)) return;
    const provider = stateRef.current.accounts.find((a) => a.id === task.accountId)?.provider;
    const write = taskWriteFields({ ...form, accountId: task.accountId }, provider);
    rawDispatch({ type: "upsertTask", task: taskOfWrite(task.id, task.accountId, write, task) });
    // Put back as it was, unless something newer has been shown for the task since.
    const restore = () => rawDispatch({ type: "upsertTask", task });
    void (async () => {
      const id = await queueTaskWrite({ action: "update", task_id: task.id }, write);
      if (!id) {
        restore();
        saveFailed();
        return;
      }
      const result = await followTaskUpdate(id, 60_000, 2000, "Saving the task is taking too long. Check that the worker is running.");
      if (result.status === "failed") {
        restore();
        toast(result.error ?? "The task could not be changed.");
        return;
      }
      rawDispatch({ type: "patchTask", id: task.id, patch: { pending: false } });
    })();
  }, [userId, saveFailed, queueTaskWrite]);

  const deleteTask = useCallback((task: Task) => {
    if (!userId || isTempTask(task)) return;
    rawDispatch({ type: "removeTask", id: task.id });
    void (async () => {
      const id = await queueTaskWrite({ action: "delete", task_id: task.id });
      if (!id) {
        rawDispatch({ type: "upsertTask", task });
        saveFailed();
        return;
      }
      const result = await followTaskUpdate(id, 60_000, 2000, "Deleting the task is taking too long. Check that the worker is running.");
      if (result.status === "failed") {
        rawDispatch({ type: "upsertTask", task });
        toast(result.error ?? "The task could not be deleted.");
        return;
      }
      toast("Task deleted.");
    })();
  }, [userId, saveFailed, queueTaskWrite]);

  // One value per change, so components that read the store redraw only when something changed.
  const value = useMemo<Ctx>(() => ({
    ...listState(state), dispatch, contactById, threadById, messages, messagesByThread, messagesFor, messagesLoaded, loadMessages, loadOlderMessages, hasOlder, removePending, prefetchMessages,
    listThreads, notify, markRead, archive, trash, pin, send, replyTo, setReplyTo, react, composeEmail, composeWhatsApp, composed, refreshCompose, ensureThread,
    saveSendAddresses, generateDraft, discardDraft, requestAutoDraft, generateComposeDraft, composeDrafts, discardComposeDraft, setJunk, unsubscribe, confirmUnsubscribe, drafting, hydrated, giveFeedback, mergeContacts, splitContact, undoMerge, refreshContacts,
    contactsVersion, contactsReady, tasks, tickTask, createTask, editTask, deleteTask,
  }), [
    state, dispatch, contactById, threadById, messages, messagesByThread, messagesFor, messagesLoaded, loadMessages, loadOlderMessages, hasOlder, removePending, prefetchMessages,
    listThreads, notify, markRead, archive, trash, pin, send, replyTo, setReplyTo, react, composeEmail, composeWhatsApp, composed, refreshCompose, ensureThread,
    saveSendAddresses, generateDraft, discardDraft, requestAutoDraft, generateComposeDraft, composeDrafts, discardComposeDraft, setJunk, unsubscribe, confirmUnsubscribe, drafting, hydrated, giveFeedback, mergeContacts, splitContact, undoMerge, refreshContacts,
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
