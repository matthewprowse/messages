// Pure filters and sort ranks over conversations for the app store (store.tsx): which view, filter or priority a thread
// belongs to, and the mail actions. No state of its own.


import type { ListFilter, Message, Priority, Thread, View } from "../types";
import { State } from "./reducer";

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
    case "unread": return t.unread;
    case "email": return t.channel === "email";
    case "whatsapp": return t.channel === "whatsapp";
    case "waiting": return isWaiting(t);
    default: return true;
  }
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
