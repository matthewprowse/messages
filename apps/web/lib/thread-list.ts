// Pure pieces of the Inbox conversation list: the views and filters it offers, the links between them, the empty-state
// copy, which conversations a search matches, and which accounts need their name shown. The components in
// components/thread-list/ add the React and routing.

import { priorityNow } from "./app-store/thread-filters";
import type { Account, Channel, ListFilter, Thread, View } from "./types";

export const VIEWS: { key: View; label: string }[] = [
  { key: "all", label: "All" },
  { key: "priority", label: "Priority" },
  { key: "junk", label: "Junk" },
  { key: "subscriptions", label: "Subscriptions" },
  { key: "archive", label: "Archive" },
  { key: "snoozed", label: "Snoozed" },
  { key: "deleted", label: "Deleted" },
];

/** Every channel a conversation can be on, in the order the filters list them. */
export const CHANNEL_LABELS: Record<Channel, string> = {
  email: "Email", whatsapp: "WhatsApp", linkedin: "LinkedIn", instagram: "Instagram", teams: "Teams", google_chat: "Google Chat", zoom: "Zoom",
};
const CHANNELS = Object.keys(CHANNEL_LABELS) as Channel[];
const isChannel = (raw: string): raw is Channel => Object.hasOwn(CHANNEL_LABELS, raw);

/** The channels you have conversations on, in filter order. A filter by channel only means something with two or more. */
export function channelsOf(threads: Pick<Thread, "channel">[]): Channel[] {
  const have = new Set(threads.map((t) => t.channel));
  return CHANNELS.filter((c) => have.has(c));
}

/** The filter's name in a select or a saved view's suggested name; "none" has no name of its own. */
export function filterLabel(filter: ListFilter): string | undefined {
  return filter === "unread" ? "Unread" : filter === "waiting" ? "Waiting" : filter === "none" ? undefined : CHANNEL_LABELS[filter];
}

/** The Inbox's filter choices: No Filter, Unread, a channel for each you have (when there are two or more), Waiting. */
export function filterOptions(channels: Channel[]): { key: ListFilter; label: string }[] {
  return [
    { key: "none", label: "No Filter" },
    { key: "unread", label: "Unread" },
    ...(channels.length > 1 ? channels.map((c) => ({ key: c, label: CHANNEL_LABELS[c] })) : []),
    { key: "waiting", label: "Waiting" },
  ];
}

/**
 * Whether a filter makes sense in a view. Subscriptions are all email, so only Unread applies there; Deleted has none.
 * Waiting (they owe you an answer) is for All: Priority only holds conversations waiting on you.
 */
export function filterFits(view: View, filter: ListFilter): boolean {
  if (filter === "none") return true;
  if (view === "deleted") return false;
  if (view === "subscriptions") return filter === "unread";
  return filter !== "waiting" || view === "all";
}

export const EMPTY: Record<View, { title: string; description: string }> = {
  all: { title: "You're All Caught Up", description: "New messages appear within seconds of arriving." },
  priority: { title: "Nothing Needs You Right Now", description: "Urgent and important conversations appear here." },
  junk: { title: "No Junk", description: "Spam and cold outreach the AI sorts out lands here." },
  archive: { title: "Nothing Archived", description: "Conversations you archive are kept here until you move them back." },
  subscriptions: { title: "No Subscriptions", description: "Newsletters, promotions and alerts you can unsubscribe from land here." },
  snoozed: { title: "Nothing Snoozed", description: "Snoozed conversations wait here and return to your inbox at the time you chose, or when they reply." },
  deleted: { title: "Nothing Deleted", description: "Conversations you delete can be restored from here." },
};

/** The empty-state copy for a view, or for a filter that explains itself (Waiting has a two day rule people cannot guess). */
export function emptyFor(view: View, filter: ListFilter) {
  if (filter === "waiting") return { title: "Nothing Waiting", description: "A conversation appears here when you wrote last, expected an answer, and none has come for 2 days." };
  if (filter === "unread") return { title: "Nothing Unread", description: "Every conversation here has been read." };
  return EMPTY[view];
}

/** A path with its query string, or the bare path when the query is empty. */
export function withQuery(path: string, query: string) {
  return query ? `${path}?${query}` : path;
}

/** The inbox link for a view, filter and label; defaults are left out of the address. */
export function listHref(view: View, filter: ListFilter, label?: string) {
  const p = new URLSearchParams();
  if (view !== "all") p.set("view", view);
  // A filter that does not apply to the view (WhatsApp in Subscriptions) is left out of its link.
  if (filter !== "none" && filterFits(view, filter)) p.set("filter", filter);
  if (label) p.set("label", label);
  return withQuery("/inbox", p.toString());
}

/** A filter from the address, "none" when it is missing or unknown. Any channel is accepted, had or not: it then matches nothing. */
export function filterOf(raw: string | null): ListFilter {
  return raw === "unread" || raw === "waiting" || (raw !== null && isChannel(raw)) ? raw : "none";
}

/** A view from the address, "all" when it is missing or unknown. */
export function viewOf(raw: string | null): View {
  return raw === "priority" || raw === "junk" || raw === "subscriptions" || raw === "archive" || raw === "snoozed" || raw === "deleted" ? raw : "all";
}

/** Whether a conversation matches a lower-cased search term: its name, subject or preview. */
export function matchesSearch(t: Thread, term: string, nameOf: (t: Thread) => string | undefined) {
  return [t.isGroup ? t.groupName : nameOf(t), t.fallbackName, t.subject, t.preview].some((s) => s?.toLowerCase().includes(term));
}

/** Names for accounts of a service the person has two or more of, by account id. Others need no name beside the logo. */
export function accountNameMap(accounts: Pick<Account, "id" | "provider" | "nickname" | "label">[]) {
  const count = new Map<string, number>();
  for (const a of accounts) count.set(a.provider, (count.get(a.provider) ?? 0) + 1);
  return new Map(accounts.filter((a) => (count.get(a.provider) ?? 0) > 1).map((a) => [a.id, a.nickname || a.label]));
}

/**
 * The one marker a row carries for the AI's triage: Urgent beats Needs Reply, and neither shows once you have answered.
 * Urgent lasts a day from the latest message (priorityNow), then the row falls back to Needs Reply or nothing.
 */
export type RowMarker = "urgent" | "needs_reply" | null;
export function rowMarker(t: Pick<Thread, "priority" | "needsReply" | "lastFromMe" | "junk" | "status" | "lastMessageAt">, now: number = Date.now()): RowMarker {
  if (t.lastFromMe || t.junk || t.status === "archived" || t.status === "trash") return null;
  if (priorityNow(t, now) === "urgent") return "urgent";
  return t.needsReply ? "needs_reply" : null;
}

/**
 * The conversation to open once `gone` have left the list: the first one after the open conversation that stays,
 * else the nearest before it, else null (nothing left, show the list). `order` is the list top to bottom.
 */
export function advanceTarget(order: string[], gone: Iterable<string>, openId: string): string | null {
  const away = new Set(gone);
  const at = order.indexOf(openId);
  if (at === -1) return null;
  for (let i = at + 1; i < order.length; i++) if (!away.has(order[i])) return order[i];
  for (let i = at - 1; i >= 0; i--) if (!away.has(order[i])) return order[i];
  return null;
}

/** The row J (1) or K (-1) moves to from the open or focused one; with none open, J takes the first and K the last. Stays put at either end. */
export function stepTarget(order: string[], currentId: string | null, step: 1 | -1): string | null {
  if (order.length === 0) return null;
  const at = currentId ? order.indexOf(currentId) : -1;
  if (at === -1) return step === 1 ? order[0] : order[order.length - 1];
  return order[Math.min(order.length - 1, Math.max(0, at + step))];
}

/** Counts for the empty pane and the view buttons: unread conversations, and those the AI marked as needing you. */
export function inboxCounts(threads: Pick<Thread, "unread" | "priority" | "needsReply" | "lastFromMe" | "junk" | "status" | "lastMessageAt">[]) {
  let unread = 0;
  let attention = 0;
  for (const t of threads) {
    if (t.junk || t.status !== "inbox") continue;
    if (t.unread) unread++;
    if (rowMarker(t)) attention++;
  }
  return { unread, attention };
}
