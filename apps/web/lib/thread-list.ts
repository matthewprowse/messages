// Pure pieces of the Inbox conversation list: the views and filters it offers, the links between them, the empty-state
// copy, which conversations a search matches, and which accounts need their name shown. The components in
// components/thread-list/ add the React and routing.

import { filtersForView } from "./selection";
import type { Account, ListFilter, Thread, View } from "./types";

export const VIEWS: { key: View; label: string }[] = [
  { key: "all", label: "All" },
  { key: "priority", label: "Priority" },
  { key: "junk", label: "Junk" },
  { key: "subscriptions", label: "Subscriptions" },
  { key: "archive", label: "Archive" },
];

export const FILTER_OPTIONS: { key: ListFilter; label: string }[] = [
  { key: "none", label: "No Filter" },
  { key: "unread", label: "Unread" },
  { key: "email", label: "Email" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "waiting", label: "Waiting" },
];

export const EMPTY: Record<View, { title: string; description: string }> = {
  all: { title: "You're All Caught Up", description: "New messages appear within seconds of arriving." },
  priority: { title: "Nothing Needs You Right Now", description: "Urgent and important conversations appear here." },
  junk: { title: "No Junk", description: "Spam and cold outreach the AI sorts out lands here." },
  archive: { title: "Nothing Archived", description: "Conversations you archive are kept here until you move them back." },
  subscriptions: { title: "No Subscriptions", description: "Newsletters, promotions and alerts you can unsubscribe from land here." },
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

/** The inbox link for a view and filter; defaults are left out of the address. */
export function listHref(view: View, filter: ListFilter) {
  const p = new URLSearchParams();
  if (view !== "all") p.set("view", view);
  // A filter that does not apply to the view (WhatsApp in Subscriptions) is left out of its link.
  if (filter !== "none" && filtersForView(view).includes(filter)) p.set("filter", filter);
  return withQuery("/inbox", p.toString());
}

/** A filter from the address, "none" when it is missing or unknown. */
export function filterOf(raw: string | null): ListFilter {
  return raw && FILTER_OPTIONS.some((o) => o.key === raw) ? (raw as ListFilter) : "none";
}

/** A view from the address, "all" when it is missing or unknown. */
export function viewOf(raw: string | null): View {
  return raw === "priority" || raw === "junk" || raw === "subscriptions" || raw === "archive" ? raw : "all";
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

/** The one marker a row carries for the AI's triage: Urgent beats Needs Reply, and neither shows once you have answered. */
export type RowMarker = "urgent" | "needs_reply" | null;
export function rowMarker(t: Pick<Thread, "priority" | "needsReply" | "lastFromMe" | "junk" | "status">): RowMarker {
  if (t.lastFromMe || t.junk || t.status === "archived" || t.status === "trash") return null;
  if (t.priority === "urgent") return "urgent";
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
export function inboxCounts(threads: Pick<Thread, "unread" | "priority" | "needsReply" | "lastFromMe" | "junk" | "status">[]) {
  let unread = 0;
  let attention = 0;
  for (const t of threads) {
    if (t.junk || t.status !== "inbox") continue;
    if (t.unread) unread++;
    if (rowMarker(t)) attention++;
  }
  return { unread, attention };
}
