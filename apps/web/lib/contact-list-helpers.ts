// Pure helpers for the Contacts list: the sort and view held in the URL, row text, ordering and search matching.
// No React, so they are tested without a browser (contact-list-helpers.test.ts). Used by components/contact-list.tsx.

import { formatPhone } from "./format";
import type { ContactSummary } from "./contacts";
import { phoneQueryMatches } from "./phone-search";

export type Sort = "recent" | "name";
export type View = "people" | "companies" | "hidden";

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Their first address, or else their first number formatted for display. */
export function firstReach(c: { emails: string[]; phones: string[] }) {
  return c.emails[0] ?? (c.phones[0] ? formatPhone(c.phones[0]) : "");
}

/** Most recent conversation first, then by name. */
export function byRecent(a: { name: string; lastAt: string | null }, b: { name: string; lastAt: string | null }) {
  return (b.lastAt ?? "").localeCompare(a.lastAt ?? "") || a.name.localeCompare(b.name);
}

/** The query string for a sort and view; the defaults (people, recent) leave it out so the URL stays clean. */
export function queryOf(sort: Sort, view: View) {
  return [view === "companies" ? "view=companies" : view === "hidden" ? "view=hidden" : "", sort === "name" ? "sort=name" : ""].filter(Boolean).join("&");
}

/** Reads sort and view from search params, falling back to the defaults for anything unknown. */
export function sortAndView(params: { get: (key: string) => string | null }): { sort: Sort; view: View; query: string } {
  const sort: Sort = params.get("sort") === "name" ? "name" : "recent";
  const view: View = params.get("view") === "companies" ? "companies" : params.get("view") === "hidden" ? "hidden" : "people";
  return { sort, view, query: queryOf(sort, view) };
}

/** The line under a person's name: their role and company, or else how to reach them. */
export function detailOf(c: ContactSummary) {
  const work = [c.role, c.company].filter(Boolean).join(", ");
  return work || firstReach(c);
}

export function bySort(sort: Sort) {
  return sort === "name" ? (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name) : byRecent;
}

/** Lower-cased text to search, with each number also written the way it is displayed. */
export function haystack(parts: (string | null | undefined)[], phones: string[] = []) {
  return [...parts, ...phones, ...phones.map(formatPhone)].filter(Boolean).join("\n").toLowerCase();
}

/** Whether the typed text is part of the name, an address, a number or the company. Digits match numbers however they are spaced. */
export function matchesQuery(q: string, hay: string, phoneDigits: string) {
  if (!q) return true;
  if (hay.includes(q)) return true;
  return phoneQueryMatches(q, phoneDigits);
}
