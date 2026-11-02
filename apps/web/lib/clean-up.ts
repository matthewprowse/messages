// Which bulk senders the Clean Up screen offers: senders whose email you have not opened for 90 days. Deterministic, no
// AI: a sender qualifies when none of its conversations is read and its oldest one is at least CLEAN_UP_DAYS old. The
// store only holds what it has loaded, so "never opened" means never opened in what the app can see.

import { groupSenders, type Sender } from "./subscription-senders";
import type { Contact, Thread } from "./types";

/** How long mail has sat unopened before its sender is offered. */
export const CLEAN_UP_DAYS = 90;
const DAY_MS = 86_400_000;

export interface CleanUpSender extends Sender {
  /** Every conversation of this sender in the list. */
  threadIds: string[];
  /** When the oldest unopened one arrived. */
  since: string;
  /** Some of its conversations offer a way to unsubscribe. */
  canUnsubscribe: boolean;
  /** Every one of its conversations is already Junk. */
  allJunk: boolean;
}

/** Bulk mail the app can clean up: it offers an unsubscribe, or the AI sorted it as a junk newsletter or notification. */
const isBulk = (t: Thread) => t.status !== "trash" && !t.isGroup && (t.subscription || (t.junk && (t.category === "newsletter" || t.category === "notification")));

/** Senders with nothing opened for CLEAN_UP_DAYS, most unopened mail first. */
export function cleanUpSenders(threads: Thread[], contactOf: (id: string) => Contact | undefined, now: Date = new Date()): CleanUpSender[] {
  const bulk = threads.filter(isBulk);
  const keyOf = (t: Thread) => groupSenders([t], contactOf)[0]?.key;
  const opened = new Set<string>();
  const oldest = new Map<string, string>();
  const ids = new Map<string, Thread[]>();
  for (const t of bulk) {
    const key = keyOf(t);
    if (!key) continue;
    if (!t.unread) opened.add(key);
    if (!oldest.has(key) || t.lastMessageAt < oldest.get(key)!) oldest.set(key, t.lastMessageAt);
    ids.set(key, [...(ids.get(key) ?? []), t]);
  }
  const cutoff = now.getTime() - CLEAN_UP_DAYS * DAY_MS;
  return groupSenders(bulk, contactOf)
    .filter((s) => !opened.has(s.key) && Date.parse(oldest.get(s.key) ?? "") <= cutoff)
    .map((s) => {
      const own = ids.get(s.key) ?? [];
      return { ...s, threadIds: own.map((t) => t.id), since: oldest.get(s.key)!, canUnsubscribe: own.some((t) => t.subscription), allJunk: own.every((t) => t.junk) };
    })
    .sort((a, b) => b.count - a.count);
}

/** The one plain line under a sender: how many emails sat unopened and for how long. No AI needed. */
export function cleanUpLine(s: Pick<CleanUpSender, "count" | "since">, now: Date = new Date()): string {
  const days = Math.max(CLEAN_UP_DAYS, Math.floor((now.getTime() - Date.parse(s.since)) / DAY_MS));
  return `${s.count === 1 ? "1 email" : `${s.count} emails`}, none opened in ${days} days`;
}
