// The Realtime subscriptions behind the app store: the sync worker and the AI worker write to Supabase, and every change
// arrives here within a second or so and is applied to the store.



import { useEffect } from "react";
import { toast } from "sonner";
import type { Tables } from "@messages/db";
import type { Message, Thread } from "../types";
import { supabase } from "../supabase";
import {loadChanges, loadEverything, loadMessage, loadMessageAttachments, loadMessagesAfter, loadThread, loadThreadMessages, mapDraft, mapAccount,
  mapMessage, mapThread, mapUnsubscribe, type MessageRow, 
} from "../data";
import { changesSince, resyncPlan } from "./resync-plan";
import { openAddresses, openDrafts, openMessages, openTasks, openThreads } from "../open-rows";
import { mapTask } from "../tasks";
import { track } from "../analytics";
import { ComposeDraft, ComposeStatus, PendingSend, composeStatusOf } from "./compose";
import { DraftPhase } from "./context";
import type { Action, State } from "./reducer";


export interface RealtimeDeps {
  userId: string | null;
  schedulePreDraft: (threadId: string) => void;
  rawDispatch: React.Dispatch<Action>;
  stateRef: React.MutableRefObject<State>;
  loadedRef: React.MutableRefObject<Set<string>>;
  loadingRef: React.MutableRefObject<Map<string, Promise<void>>>;
  moreRef: React.MutableRefObject<Map<string, boolean>>;
  pendingRef: React.MutableRefObject<PendingSend[]>;
  composedRef: React.MutableRefObject<Record<string, ComposeStatus | undefined>>;
  threadMapRef: React.MutableRefObject<Map<string, Thread>>;
  composeWaitRef: React.MutableRefObject<Set<string>>;
  draftWaitRef: React.MutableRefObject<Record<string, string | undefined>>;
  setComposeDrafts: React.Dispatch<React.SetStateAction<Record<string, ComposeDraft | undefined>>>;
  setComposed: React.Dispatch<React.SetStateAction<Record<string, ComposeStatus | undefined>>>;
  setDrafting: React.Dispatch<React.SetStateAction<Record<string, DraftPhase | undefined>>>;
  setPending: React.Dispatch<React.SetStateAction<PendingSend[]>>;
}

/** Subscribes to the user's rows while signed in and keeps the store current. */
export function useRealtimeSync({ userId, schedulePreDraft, rawDispatch, stateRef, loadedRef, loadingRef, moreRef, pendingRef, composedRef, threadMapRef, composeWaitRef, draftWaitRef, setComposeDrafts, setComposed, setDrafting, setPending }: RealtimeDeps) {
  // Live updates: the sync worker writes to Supabase and changes arrive here within a second or so.
  // Rows are built from the payload, so a change costs no extra request unless the payload is cut short.
  useEffect(() => {
    if (!userId) return;

    /** A new message from its Realtime row. Large rows arrive without their big columns, so those are fetched. */
    async function arrived(row: Tables<"messages">, cut: boolean): Promise<Message | null> {
      try {
        if (cut || row.body_text === undefined || row.body_html === undefined) return await loadMessage(row.id);
        const attachments = await loadMessageAttachments(row.id);
        const [opened] = await openMessages([{ ...row }]);
        return mapMessage({ ...(opened as Omit<MessageRow, "attachments">), attachments });
      } catch {
        return null;
      }
    }

    // When the connection was last known to be up, ticked while it is. A computer that slept stops the ticks, so
    // the first late tick means it woke: whatever happened meanwhile is caught up then, as the socket may not notice.
    let aliveAt = Date.now();
    let lastTick = aliveAt;
    const alive = setInterval(() => {
      const now = Date.now();
      if (now - lastTick > 120_000 && !dropped) {
        const down = now - aliveAt;
        const since = changesSince(aliveAt);
        aliveAt = now;
        setTimeout(() => { if (!stopped) void resync(down, since); }, 3000);
      } else if (!dropped && now - lastTick <= 120_000) {
        aliveAt = now;
      }
      lastTick = now;
    }, 10_000);

    /** Messages newer than the newest one held in each open conversation, or its latest page when that cannot be said. */
    async function catchUpMessages(): Promise<Set<string>> {
      const before = new Set(Object.values(stateRef.current.byThread).flatMap((list) => list.map((m) => m.id)));
      const sentIn = new Set<string>();
      await Promise.all([...loadedRef.current].map(async (threadId) => {
        const held = stateRef.current.byThread[threadId];
        const newest = held?.[held.length - 1];
        const fresh = newest ? await loadMessagesAfter(threadId, newest).catch(() => null) : null;
        const messages = fresh ?? (await loadThreadMessages(threadId).catch(() => null))?.messages;
        if (!messages) return;
        rawDispatch({ type: "mergeMessages", threadId, messages });
        if (messages.some((m) => m.from === "me" && !before.has(m.id))) sentIn.add(threadId);
      }));
      return sentIn;
    }

    // After a dropped connection, catch up on what changed while it was down: nothing after a blip, only what
    // changed after a short drop, everything after a long one or when the short way fails.
    async function resync(downMs: number, since: string) {
      const plan = resyncPlan(downMs);
      if (plan === "skip") return;
      let sentIn: Set<string>;
      try {
        let delta = false;
        if (plan === "delta") {
          try {
            rawDispatch({ type: "loaded", data: await loadChanges(since, stateRef.current.threads) });
            delta = true;
          } catch {
            delta = false;
          }
        }
        if (!delta) rawDispatch({ type: "loaded", data: await loadEverything() });
        sentIn = await catchUpMessages();
      } catch {
        return;
      }
      const outboxIds = [...pendingRef.current.map((p) => p.id), ...Object.keys(composedRef.current)];
      const { data } = outboxIds.length ? await supabase.from("outbox").select("id, status, thread_id, error").in("id", outboxIds) : { data: [] };
      const rows = new Map((data ?? []).map((r) => [r.id, r]));
      setComposed((c) => Object.fromEntries(Object.entries(c).map(([id, v]) => [id, rows.has(id) ? composeStatusOf(rows.get(id)!) : v])));
      setPending((p) => p
        .map((x) => { const r = rows.get(x.id); return r ? { ...x, status: r.status as PendingSend["status"], error: r.error ?? undefined } : x; })
        .filter((x) => !(x.status === "sent" && sentIn.has(x.threadId))));
    }

    // Changes arrive in bursts (a sync writes many rows at once). They are collected for a moment and applied
    // together, a row changed twice in that moment once, so a burst costs one pass instead of one per change.
    // Within a pass, conversations are applied before their messages, and those before everything else.
    const BATCH_MS = 250;
    const queue = new Map<string, { rank: number; run: () => Promise<void> | void }>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let flushing: Promise<void> = Promise.resolve();
    let stopped = false;
    async function flush() {
      timer = undefined;
      const batch = [...queue.values()];
      queue.clear();
      for (let rank = 0; rank <= 3 && !stopped; rank++) {
        await Promise.all(batch.filter((c) => c.rank === rank).map((c) => Promise.resolve().then(c.run).catch(() => undefined)));
      }
    }
    function queued(key: string, rank: number, run: () => Promise<void> | void) {
      queue.set(key, { rank, run }); // a repeat of the same key keeps its place and carries the newest row
      timer ??= setTimeout(() => { flushing = flushing.then(flush); }, BATCH_MS);
    }
    // Realtime applies a row filter to inserts and updates only; a deletion carries just the id.
    const mine = `user_id=eq.${userId}`;

    // When your newest sent message arrived in each conversation, to settle a placeholder whose outbox
    // update lands in the same batch as the imported message.
    const sentArrived = new Map<string, number>();

    let dropped = false;
    const channel = supabase
      .channel(`inbox-${userId}`)
      // Realtime cannot filter deletions by user, so every deletion by anyone arrives: only ids held here are acted on.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "threads" }, (payload) => {
        const id = (payload.old as { id?: string } | null)?.id;
        if (id && threadMapRef.current.has(id)) rawDispatch({ type: "removeThread", id });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "threads", filter: mine }, (payload) => {
        if (payload.eventType === "DELETE") return;
        const changed = payload.new as Tables<"threads">;
        queued(`thread:${changed.id}`, 0, async () => {
          const row = (await openThreads([changed]))[0];
          const existing = threadMapRef.current.get(row.id);
          if (existing) {
            rawDispatch({ type: "upsertThread", thread: mapThread(row, existing.participantIds, existing.provider) });
            schedulePreDraft(row.id);
            return;
          }
          if (row.status === "trash") return; // deleted conversations are not shown
          const loaded = await loadThread(row.id).catch(() => null);
          if (!loaded) return;
          rawDispatch({ type: "upsertContacts", contacts: loaded.contacts });
          rawDispatch({ type: "upsertThread", thread: loaded.thread });
          schedulePreDraft(row.id);
        });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: mine }, (payload) => {
        const row = payload.new as Tables<"messages">;
        queued(`message:${row.id}`, 1, async () => {
          // Your sent reply has been imported, so its placeholder can go, in the same render as the message.
          const dropSent = () => {
            if (row.direction === "outbound") {
              sentArrived.set(row.thread_id, Math.max(sentArrived.get(row.thread_id) ?? 0, Date.parse(row.sent_at) || Date.now()));
              setPending((p) => p.filter((x) => !(x.threadId === row.thread_id && x.status === "sent")));
            }
          };
          // A conversation still loading would replace this message when its page lands, so wait for it first.
          const loading = loadingRef.current.get(row.thread_id);
          if (loading) await loading;
          const isLoaded = loadedRef.current.has(row.thread_id) || moreRef.current.has(row.thread_id);
          if (!isLoaded) { dropSent(); return; } // loaded fresh when the conversation is opened
          const message = await arrived(row, !!payload.errors?.length);
          if (message) rawDispatch({ type: "addMessage", message });
          dropSent();
        });
      })
      // Edits, deletions and reactions change a stored message. Read state changes arrive here too and change nothing shown.
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: mine }, (payload) => {
        const changed = payload.new as Partial<Tables<"messages">> & { id: string; thread_id: string };
        queued(`message-edit:${changed.id}`, 2, async () => {
          const [row] = await openMessages([changed]);
          if (loadedRef.current.has(row.thread_id)) rawDispatch({ type: "patchMessage", threadId: row.thread_id, id: row.id, row });
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "drafts", filter: mine }, (payload) => {
        if (payload.eventType === "DELETE") return;
        const changed = payload.new as Tables<"drafts">;
        if (!changed.thread_id) {
          // A new message's draft goes to the dialog that asked for it, straight away.
          if (!composeWaitRef.current.has(changed.id) || changed.status === "pending") return;
          void openDrafts([changed]).then(([row]) => {
            if (!composeWaitRef.current.delete(row.id)) return;
            if (row.status === "active") {
              track("draft_shown", { tone: row.tone, channel: row.subject ? "email" : "whatsapp", ms: Math.max(0, Date.parse(row.updated_at) - Date.parse(row.created_at)), auto: false });
              setComposeDrafts((c) => ({ ...c, [row.id]: { status: "active", body: row.body, subject: row.subject ?? undefined, instruction: row.instruction ?? undefined } }));
            } else if (row.status === "failed") {
              setComposeDrafts((c) => ({ ...c, [row.id]: { status: "failed", error: row.error ?? "The draft could not be written." } }));
            }
          }).catch(() => {
            // The row could not be opened: the dialog stops waiting rather than spinning until its timeout.
            if (!composeWaitRef.current.delete(changed.id)) return;
            setComposeDrafts((c) => ({ ...c, [changed.id]: { status: "failed", error: "The draft could not be opened." } }));
          });
          return;
        }
        const threadId = changed.thread_id;
        // A draft someone is waiting for is shown the moment it arrives, not with the next batch.
        const waited = draftWaitRef.current[threadId] === changed.id;
        const failWaiting = () => {
          if (draftWaitRef.current[threadId] !== changed.id) return;
          delete draftWaitRef.current[threadId];
          setDrafting((d) => ({ ...d, [threadId]: undefined }));
          toast("The draft could not be opened. Try again.");
        };
        (waited ? (key: string, rank: number, run: () => Promise<void>) => void run().catch(failWaiting) : queued)(`draft:${changed.id}`, 3, async () => {
          const [row] = await openDrafts([changed]);
          if (row.status === "active") {
            const t = threadMapRef.current.get(threadId);
            if (t && t.draft?.id !== row.id) {
              track("draft_shown", { tone: row.tone, channel: t.channel, ms: Math.max(0, Date.parse(row.updated_at) - Date.parse(row.created_at)), auto: row.auto });
            }
            rawDispatch({ type: "setDraft", id: threadId, draft: mapDraft(row) });
            setDrafting((d) => ({ ...d, [threadId]: undefined }));
            if (draftWaitRef.current[threadId] === row.id) delete draftWaitRef.current[threadId];
          } else if (row.status === "failed") {
            // A draft already given up on here has had its own message.
            if (draftWaitRef.current[threadId] !== row.id) return;
            delete draftWaitRef.current[threadId];
            track("draft_failed", { code: "failed", channel: threadMapRef.current.get(threadId)?.channel ?? "email" });
            toast(row.error ?? "The draft could not be written.");
            setDrafting((d) => ({ ...d, [threadId]: undefined }));
          } else if (row.status === "discarded" || row.status === "sent" || row.status === "expired" || row.status === "revised") {
            const current = threadMapRef.current.get(threadId)?.draft;
            if (current?.id === row.id) rawDispatch({ type: "setDraft", id: threadId });
          }
        });
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "unsubscribes" }, (payload) => {
        const id = (payload.old as { id?: string } | null)?.id;
        if (id && stateRef.current.unsubscribes.some((u) => u.id === id)) rawDispatch({ type: "removeUnsubscribe", id });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "unsubscribes", filter: mine }, (payload) => {
        if (payload.eventType === "DELETE") return;
        const changed = payload.new as Tables<"unsubscribes">;
        queued(`unsubscribe:${changed.id}`, 3, async () => {
          const u = mapUnsubscribe(await openAddresses(changed));
          rawDispatch({ type: "upsertUnsubscribe", unsubscribe: u });
          if (u.status === "manual") toast(`${u.sender} needs you to confirm on their page.`);
          if (u.status === "failed") toast(u.error ?? `Could not unsubscribe from ${u.sender}.`);
        });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "outbox", filter: mine }, (payload) => {
        const row = payload.new as Tables<"outbox">;
        queued(`outbox:${row.id}`, 3, () => {
          if (row.status === "failed") toast(row.error ?? (row.account_id && !row.thread_id ? "The email could not be sent." : "The reply could not be sent."));
          setComposed((c) => (c[row.id] ? { ...c, [row.id]: composeStatusOf(row) } : c));
          setPending((p) => p
            .map((x) => (x.id === row.id ? { ...x, status: row.status as PendingSend["status"], error: row.error ?? undefined } : x))
            // Sent, and the imported copy has already arrived: nothing is left to wait for.
            .filter((x) => !(x.id === row.id && x.status === "sent" && (sentArrived.get(x.threadId) ?? 0) >= Date.parse(x.createdAt))));
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "accounts", filter: mine }, (payload) => {
        if (payload.eventType === "DELETE") return;
        const changed = payload.new as Tables<"accounts">;
        queued(`account:${changed.id}`, 3, async () => {
            rawDispatch({ type: "upsertAccount", account: mapAccount(await openAddresses(changed)) });
        });
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (dropped) void resync(Date.now() - aliveAt, changesSince(aliveAt));
          dropped = false;
          aliveAt = Date.now();
        } else {
          dropped = true; // CHANNEL_ERROR, TIMED_OUT or CLOSED; the client rejoins by itself
        }
      });

    // Tasks the worker stores or changes, on their own channel, so the inbox keeps working if this table is not published for Realtime. A resync reloads them too.
    const taskChannel = supabase
      .channel(`tasks-${userId}`)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "tasks" }, (payload) => {
        const id = (payload.old as { id?: string } | null)?.id;
        if (id && stateRef.current.tasks.some((t) => t.id === id)) rawDispatch({ type: "removeTask", id });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: mine }, (payload) => {
        if (payload.eventType === "DELETE") return;
        const changed = payload.new as Tables<"tasks">;
        queued(`task:${changed.id}`, 3, async () => {
          const [row] = await openTasks([{ ...changed }]);
          rawDispatch({ type: "upsertTask", task: mapTask(row) });
        });
      })
      .subscribe((status) => { if (status === "CHANNEL_ERROR") void supabase.removeChannel(taskChannel); });

    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(alive);
      supabase.removeChannel(channel);
      supabase.removeChannel(taskChannel);
    };
  }, [userId, schedulePreDraft]);
}
