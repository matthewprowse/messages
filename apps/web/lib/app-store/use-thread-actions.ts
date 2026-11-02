// Actions on conversations that are shown at once and saved after: read, pin, archive, trash, restore, snooze, junk,
// feedback and reactions. Mail-server changes are queued as mail_actions rows for the sync worker.

import { useCallback } from "react";
import { canReactOn } from "../reactions";
import { returnText } from "../snooze";
import { supabase } from "../supabase";
import type { Message, Thread, ThreadStatus } from "../types";
import { recordAction, recordCorrection, recordCorrections } from "./telemetry";
import { MailAction, emailIds, threadsIn } from "./thread-filters";
import type { Action, State } from "./reducer";
import { watchMailActions } from "./watch-mail-actions";

export interface ThreadActionDeps {
  userId: string | null;
  rawDispatch: React.Dispatch<Action>;
  stateRef: React.MutableRefObject<State>;
  threadMapRef: React.MutableRefObject<Map<string, Thread>>;
  notify: (text: string, undo?: () => void) => void;
  saveFailed: () => void;
}

/** The thread actions of the context, each with its optimistic change and rollback or failure toast. */
export function useThreadActions({ userId, rawDispatch, stateRef, threadMapRef, notify, saveFailed }: ThreadActionDeps) {
  // Changes the mail server should know about are queued for the sync worker, which applies them there.
  // Resolves once the rows are written, so a follow-up action can be queued after it and the worker sees them in order.
  const queueMailAction = useCallback(async (threadId: string | string[], action: MailAction) => {
    const ids = Array.isArray(threadId) ? threadId : [threadId];
    if (ids.length === 0) return;
    const { data, error } = await supabase.from("mail_actions").insert(ids.map((thread_id) => ({ thread_id, action }))).select("id");
    if (error) saveFailed();
    // The worker may refuse it later (the provider said no): watch the rows so the user hears, rather than believe it worked.
    else watchMailActions((data ?? []).map((r) => r.id));
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

  const unarchive = useCallback((ids: string | string[]) => {
    const before = threadsIn(stateRef.current.threads, ids).filter((t) => t.status === "archived");
    if (before.length === 0) return;
    recordAction(before, "unarchive");
    saveStatus(before.map((t) => t.id), "inbox");
    queueMailAction(emailIds(before), "unarchive");
    notify(before.length === 1 ? "Moved to Inbox" : `Moved ${before.length} conversations to Inbox`, () => {
      restoreStatus(before);
      queueMailAction(emailIds(before), "archive");
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
      // Untrash brings a conversation back to the inbox at the provider, so one that was archived is archived again after it.
      void queueMailAction(emailIds(before), "untrash").then(() => queueMailAction(emailIds(before.filter((t) => t.status === "archived")), "archive"));
    });
  }, [notify, saveStatus, restoreStatus, queueMailAction]);

  // Brings deleted conversations back to the inbox (and the provider's inbox for email). They were not in the store, so
  // they are put in it. Resolves false when it could not be saved.
  const restore = useCallback(async (threads: Thread[]): Promise<boolean> => {
    if (threads.length === 0) return true;
    const { error } = await supabase.from("threads").update({ status: "inbox" }).in("id", threads.map((t) => t.id));
    if (error) { saveFailed(); return false; }
    recordAction(threads, "restore");
    for (const t of threads) rawDispatch({ type: "upsertThread", thread: { ...t, status: "inbox" } });
    queueMailAction(emailIds(threads), "untrash");
    notify(threads.length === 1 ? "Restored to Inbox" : `Restored ${threads.length} conversations to Inbox`);
    return true;
  }, [notify, saveFailed, queueMailAction]);

  // Snooze and reminders are saved on the thread. The app hides a thread while the time is ahead, and a new message
  // from them clears it in the database (see 20261118110000_snooze_labels.sql), so there is no job to bring it back.
  const saveSnooze = useCallback((ids: string[], until: string | null, kind: Thread["snoozeKind"] | null) => {
    rawDispatch({ type: "patchThreads", ids, patch: { snoozedUntil: until ?? undefined, snoozeKind: kind ?? undefined } });
    supabase.from("threads").update({ snoozed_until: until, snooze_kind: kind, snoozed_at: until ? new Date().toISOString() : null }).in("id", ids)
      .then(({ error }) => { if (error) saveFailed(); });
  }, [saveFailed]);

  // Undo puts each conversation back with the snooze it had before.
  const restoreSnooze = useCallback((before: Thread[]) => {
    for (const t of before) saveSnooze([t.id], t.snoozedUntil ?? null, t.snoozeKind ?? null);
  }, [saveSnooze]);

  const snooze = useCallback((ids: string | string[], at: Date, kind: "snooze" | "reminder" = "snooze") => {
    const before = threadsIn(stateRef.current.threads, ids);
    if (before.length === 0) return;
    recordAction(before, kind === "snooze" ? "snooze" : "remind_if_no_reply");
    saveSnooze(before.map((t) => t.id), at.toISOString(), kind);
    const when = returnText(at.toISOString());
    const text = kind === "snooze" ? (before.length === 1 ? `Snoozed until ${when}` : `Snoozed ${before.length} conversations until ${when}`) : `You will be reminded ${when} if there is no reply`;
    notify(text, () => restoreSnooze(before));
  }, [notify, saveSnooze, restoreSnooze]);

  const unsnooze = useCallback((ids: string | string[]) => {
    const before = threadsIn(stateRef.current.threads, ids).filter((t) => t.snoozedUntil);
    if (before.length === 0) return;
    recordAction(before, "unsnooze");
    saveSnooze(before.map((t) => t.id), null, null);
    notify(before.length === 1 ? "Moved back to Inbox" : `Moved ${before.length} conversations back to Inbox`, () => restoreSnooze(before));
  }, [notify, saveSnooze, restoreSnooze]);

  // Shown at once; the worker sends it over WhatsApp and the stored message then matches.
  const react = useCallback((message: Message, emoji: string) => {
    // A last line of defence: the UI hides the button, but nothing may queue a reaction a channel cannot send (reactions.ts).
    if (!canReactOn(threadMapRef.current.get(message.threadId)?.channel)) return;
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

  // Junk you choose yourself also goes to the provider's spam; junk the AI sorts out stays where it is there.
  const setJunk = useCallback((threadIds: string | string[], junk: boolean) => {
    if (!userId) return;
    const before = threadsIn(stateRef.current.threads, threadIds).filter((t) => t.junk !== junk);
    if (before.length === 0) return;
    const ids = before.map((t) => t.id);
    recordAction(before, junk ? "junk" : "not_junk");
    recordCorrections(before, "junk", (t) => (t.junk ? "junk" : "not_junk"), junk ? "junk" : "not_junk");
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

  return { markRead, pin, archive, unarchive, trash, restore, snooze, unsnooze, react, setJunk, giveFeedback };
}
