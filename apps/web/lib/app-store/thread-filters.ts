// Pure filters and sort ranks over conversations for the app store (store.tsx): which view, filter or priority a thread
// belongs to, and the mail actions. No state of its own.


import type { ListFilter, Message, Priority, Thread, View } from "../types";
import type { State } from "./reducer";

/** Sort order for priority, lowest number first. */
export const rank: Record<Priority, number> = { urgent: 0, important: 1, normal: 2, low: 3 };
export const NO_MESSAGES: Message[] = [];

// Junk splits in two: Subscriptions (it offers a way to unsubscribe) and Junk (spam, cold outreach).
// Archive holds archived conversations whatever they are; every other view holds only the inbox's. Snoozed takes any
// (selectors.ts picks the snoozed ones out). Deleted is read from the database when opened, so no loaded thread is in it.
export const inView = (t: Thread, view: View) =>
  view === "archive" || view === "snoozed" ? true : view === "deleted" ? false : view === "junk" ? t.junk && !t.subscription : view === "subscriptions" ? t.junk && t.subscription : !t.junk;
// Once you have answered, a conversation does not need you until they write again.
export const isPriority = (t: Thread) => (t.priority === "urgent" || t.priority === "important") && !t.lastFromMe && t.category !== "newsletter" && t.category !== "notification";

export function inFilter(t: Thread, filter: ListFilter) {
  switch (filter) {
    case "none": return true;
    case "unread": return t.unread;
    case "waiting": return isWaiting(t);
    // Every other filter is a channel.
    default: return t.channel === filter;
  }
}

/** How long Urgent lasts: after this since the latest message it reads as Important, so old urgency stops shouting. */
export const URGENT_HOURS = 24;
/** The priority as the lists show it now: Urgent fades to Important URGENT_HOURS after the latest message. */
export function priorityNow(t: Pick<Thread, "priority" | "lastMessageAt">, now: number = Date.now()): Priority {
  return t.priority === "urgent" && now - Date.parse(t.lastMessageAt) > URGENT_HOURS * 3_600_000 ? "important" : t.priority;
}

/** Waiting: you wrote last, your message expects an answer, and none has come for WAITING_DAYS. */
export const WAITING_DAYS = 2;
export const isWaiting = (t: Thread, now: number = Date.now()) => t.lastFromMe && !!t.waiting && now - Date.parse(t.lastMessageAt) >= WAITING_DAYS * 86_400_000;

export type MailAction = "read" | "unread" | "archive" | "unarchive" | "trash" | "untrash" | "spam" | "unspam";

export function threadsIn(threads: Thread[], ids: string | string[]): Thread[] {
  const wanted = new Set(Array.isArray(ids) ? ids : [ids]);
  return threads.filter((t) => wanted.has(t.id));
}

/** The state as the screens read it: messages are offered per conversation instead. */
export function listState({ byThread, ...rest }: State): Omit<State, "byThread"> {
  void byThread;
  return rest;
}

/** Only email conversations have a mail server to tell. */
export function emailIds(threads: Thread[]): string[] {
  return threads.filter((t) => t.channel === "email").map((t) => t.id);
}
