// Which conversations to load before anyone opens them, once the app has loaded and the browser is idle: the newest few
// in the inbox that are unread or need you, the ones most likely to be opened next. Pure, so the choice is tested.

import type { Thread } from "../types";
import { isSnoozed } from "../snooze";
import { rowMarker } from "../thread-list";

/** How many conversations the idle prefetch loads. Each is one read from far away, so a handful, not the whole list. */
export const IDLE_PREFETCH_THREADS = 5;
/** How many of those load at once, so they never crowd out a conversation being opened. */
export const IDLE_PREFETCH_CONCURRENCY = 2;

type Pickable = Pick<Thread, "id" | "unread" | "priority" | "needsReply" | "lastFromMe" | "junk" | "status" | "lastMessageAt" | "pinned" | "snoozedUntil" | "snoozeKind">;

/**
 * The ids to prefetch, best first: inbox conversations (not junk, not snoozed) that are unread or carry a marker, pinned
 * first and then newest, as the list shows them. Ones already loaded (`loaded`) are skipped, not counted.
 */
export function idlePrefetchIds(threads: readonly Pickable[], loaded: (id: string) => boolean, limit = IDLE_PREFETCH_THREADS, now: number = Date.now()): string[] {
  return threads
    .filter((t) => t.status === "inbox" && !t.junk && !isSnoozed(t, now) && (t.unread || rowMarker(t, now) !== null) && !loaded(t.id))
    .sort((a, b) => (a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : b.lastMessageAt.localeCompare(a.lastMessageAt)))
    .slice(0, Math.max(0, limit))
    .map((t) => t.id);
}
