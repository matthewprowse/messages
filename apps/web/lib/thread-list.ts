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
