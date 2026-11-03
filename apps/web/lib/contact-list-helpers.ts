// Pure helpers for the Contacts list: the sort and view held in the URL, row text, ordering and search matching.
// No React, so they are tested without a browser (contact-list-helpers.test.ts). Used by components/contact-list.tsx.

import { formatPhone } from "./format";
import type { ContactSummary } from "./contacts";
import { isPlaceholderName } from "./merging";
import { phoneQueryMatches } from "./phone-search";
import { DEFAULT_QUIET_DAYS, quietDaysOf } from "./going-quiet";
import { ALL_RELATIONSHIPS } from "./relationships";
import type { Thread } from "./types";

export type Sort = "recent" | "name";
export type View = "people" | "companies" | "hidden" | "quiet";

/** The list's filters held in the URL: a relationship ("all" for none) and, in Going Quiet, the days of silence. */
export interface Filters {
  rel: string;
  quiet: number;
}
export const NO_FILTERS: Filters = { rel: ALL_RELATIONSHIPS, quiet: DEFAULT_QUIET_DAYS };

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Their first address, or else their first number formatted for display. */
export function firstReach(c: { emails: string[]; phones: string[] }) {
  return c.emails[0] ?? (c.phones[0] ? formatPhone(c.phones[0]) : "");
}

// One collator, built once: accents and case do not decide the order, and "2" sorts before "10".
const collator = new Intl.Collator("en-ZA", { sensitivity: "base", numeric: true });

/** By name as it is read: real names in order, then the contacts that are only a number or an address. */
export function byName(a: { name: string }, b: { name: string }) {
  return Number(isPlaceholderName(a.name)) - Number(isPlaceholderName(b.name)) || collator.compare(a.name, b.name);
}

/** Most recent conversation first, then by name. Timestamps are ISO strings, which order as plain text. */
export function byRecent(a: { name: string; lastAt: string | null }, b: { name: string; lastAt: string | null }) {
  const x = a.lastAt ?? "";
  const y = b.lastAt ?? "";
  return x === y ? byName(a, b) : x < y ? 1 : -1;
}

/** The query string for a sort, view and filters; the defaults (people, recent, all, 30 days) leave it out so the URL stays clean. */
export function queryOf(sort: Sort, view: View, filters: Filters = NO_FILTERS) {
  return [
    view !== "people" ? `view=${view}` : "",
    sort === "name" ? "sort=name" : "",
    filters.rel !== ALL_RELATIONSHIPS ? `rel=${encodeURIComponent(filters.rel)}` : "",
    view === "quiet" && filters.quiet !== DEFAULT_QUIET_DAYS ? `quiet=${filters.quiet}` : "",
  ].filter(Boolean).join("&");
}

const VIEWS: View[] = ["companies", "hidden", "quiet"];

/** Reads sort, view and filters from search params, falling back to the defaults for anything unknown. */
export function sortAndView(params: { get: (key: string) => string | null }): { sort: Sort; view: View; query: string } & Filters {
  const sort: Sort = params.get("sort") === "name" ? "name" : "recent";
  const view: View = VIEWS.find((v) => v === params.get("view")) ?? "people";
  const filters: Filters = { rel: params.get("rel")?.trim().slice(0, 60) || ALL_RELATIONSHIPS, quiet: quietDaysOf(params.get("quiet")) };
  return { sort, view, query: queryOf(sort, view, filters), ...filters };
}

/**
 * The line under a person's name: how to reach them (number, Instagram, address, the first of each), else their role
 * and company. Where you stand with them is on their page, not here: in a list it said "Waiting on you" on every row.
 */
export function detailOf(c: Pick<ContactSummary, "emails" | "phones" | "handles" | "role" | "company">) {
  const reach = [c.phones[0] && formatPhone(c.phones[0]), c.handles[0] && `@${c.handles[0]}`, c.emails[0]].filter(Boolean).join(" · ");
  return reach || [c.role, c.company].filter(Boolean).join(", ");
}

/**
 * Unread messages per contact across all their one-to-one conversations (email, WhatsApp, LinkedIn, Instagram), counted
 * as the Inbox counts them (lib/person-groups.ts): an unread thread with no count is one. Groups are left out.
 */
export function unreadByPerson(threads: Pick<Thread, "isGroup" | "participantIds" | "unread" | "unreadCount">[]) {
  const counts = new Map<string, number>();
  for (const t of threads) {
    const id = t.isGroup ? undefined : t.participantIds[0];
    if (id && t.unread) counts.set(id, (counts.get(id) ?? 0) + Math.max(t.unreadCount, 1));
  }
  return counts;
}

export function bySort(sort: Sort) {
  return sort === "name" ? byName : byRecent;
}

/** Starred people first, then the chosen order. */
export function byVipThen(sort: Sort) {
  const order = bySort(sort);
  return (a: { name: string; lastAt: string | null; vip?: boolean }, b: { name: string; lastAt: string | null; vip?: boolean }) => Number(!!b.vip) - Number(!!a.vip) || order(a, b);
}

/** Lower case without accents, so "Zoë" is found by "zoe" and the other way round. */
export function fold(s: string) {
  return s.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();
}

/** Folded text to search, with each number also written the way it is displayed. */
export function haystack(parts: (string | null | undefined)[], phones: string[] = []) {
  return fold([...parts, ...phones, ...phones.map(formatPhone)].filter(Boolean).join("\n"));
}

/**
 * Whether the typed text is part of the name, an address, a number or the company. Every word typed must be found,
 * in any order ("smith john" finds John Smith). Digits match numbers however they are spaced. The query is folded.
 */
export function matchesQuery(q: string, hay: string, phoneDigits: string) {
  if (!q) return true;
  if (hay.includes(q) || phoneQueryMatches(q, phoneDigits)) return true;
  const words = q.split(/\s+/).filter(Boolean);
  return words.length > 1 && words.every((w) => hay.includes(w));
}
