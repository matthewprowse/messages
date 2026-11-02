// Pure derivations the store provider memoises: stored messages with queued replies laid in, and the sorted,
// filtered list for a (view, filter) key. No React, so both are tested directly (selectors.test.ts).

import type { ListFilter, Message, Thread, View } from "../types";
import type { PendingSend } from "./compose";
import { sendRecovery } from "../send-safety";
import { sendStateOf } from "../thread-send-state";
import { inFilter, inView, isPriority, rank } from "./thread-filters";

/** Queued replies follow the stored messages. A conversation without any queued keeps its stored list as is. */
export function withQueuedReplies(byThread: Record<string, Message[]>, pending: PendingSend[]): Map<string, Message[]> {
  const queued = new Map<string, Message[]>();
  for (const p of pending) {
    const m: Message = {
      id: `outbox:${p.id}`,
      threadId: p.threadId,
      from: "me",
      sentAt: p.createdAt,
      body: p.body,
      attachments: p.attachments,
      sendState: sendStateOf(p.status),
      sendError: p.error,
      sendRecovery: p.status === "failed" ? sendRecovery(p.error, p.fileCount ?? p.attachments?.length ?? 0) : undefined,
    };
    queued.set(p.threadId, [...(queued.get(p.threadId) ?? []), m]);
  }
  const out = new Map(Object.entries(byThread));
  for (const [threadId, list] of queued) out.set(threadId, [...(out.get(threadId) ?? []), ...list]);
  return out;
}

/** The threads of a list screen: key is "view:filter". Pinned first, then (in Priority) by rank, then newest first. */
export function listThreadsFor(threads: Thread[], key: string): Thread[] {
  const [view, filter] = key.split(":") as [View, ListFilter];
  return threads
    .filter((t) => t.status === (view === "archive" ? "archived" : "inbox") && inView(t, view) && (view !== "priority" || isPriority(t)) && inFilter(t, filter))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (view === "priority" && rank[a.priority] !== rank[b.priority]) return rank[a.priority] - rank[b.priority];
      return b.lastMessageAt.localeCompare(a.lastMessageAt);
    });
}
