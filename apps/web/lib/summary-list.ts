// Pure pieces of the Summary list: its filters and links, which of today's events still belong on it, and where J and K
// move focus. The components in components/summary/ add React, routing and the store.

import type { CalendarEvent } from "./calendar";
import { CHANNEL_LABELS, filterOf as inboxFilterOf } from "./thread-list";
import type { Channel, ListFilter } from "./types";

export const SUMMARY_BASE = "/summary";

/** The Summary's filter choices: All, a channel for each you have (when there are two or more), Waiting on Others. */
export function filterOptions(channels: Channel[]): { key: ListFilter; label: string }[] {
  return [
    { key: "none", label: "All" },
    ...(channels.length > 1 ? channels.map((c) => ({ key: c, label: CHANNEL_LABELS[c] })) : []),
    // Replaces Unread: this page is already what needs you, so the useful other half is what waits on them.
    { key: "waiting", label: "Waiting on Others" },
  ];
}

/** The Summary link for a filter; no filter is the bare path. With `openId` it keeps that conversation open beside the list. */
export function listHref(filter: ListFilter, openId?: string) {
  const path = openId ? `${SUMMARY_BASE}/${encodeURIComponent(openId)}` : SUMMARY_BASE;
  return filter === "none" ? path : `${path}?filter=${filter}`;
}

/** How many Older conversations show before Show All. */
export const OLDER_SHOWN = 3;

/**
 * The conversation to open once the open one is done (archived, deleted, answered). `before` is the list as it was
 * with the open one still in it: the next row down takes its place, else the one above. Undefined when nothing is left.
 */
export function nextAfterDone(before: string[], after: string[], openId: string): string | undefined {
  const at = before.indexOf(openId);
  if (at === -1) return undefined;
  const left = new Set(after);
  return before.slice(at + 1).find((id) => left.has(id)) ?? before.slice(0, at).reverse().find((id) => left.has(id));
}

/** A filter from the address, "none" when it is missing, unknown or Unread (the Summary has no Unread). */
export function filterOf(raw: string | null): ListFilter {
  const filter = inboxFilterOf(raw);
  return filter === "unread" ? "none" : filter;
}

/** How long an event with no end time stays on the list after it starts. */
export const NO_END_MINUTES = 60;

/**
 * Today's events that have not finished yet, all-day ones first, then by start. `isToday` says whether an event
 * runs today (calendar.ts daysOf, passed in so this module stays free of the database client). An event with no end
 * time is treated as lasting NO_END_MINUTES.
 */
export function unfinishedEvents(loaded: CalendarEvent[], isToday: (e: CalendarEvent) => boolean, now: Date): CalendarEvent[] {
  return loaded
    .filter(isToday)
    .filter((e) => e.allDay || (e.endsAt ? new Date(e.endsAt) : new Date(Date.parse(e.startsAt) + NO_END_MINUTES * 60_000)) > now)
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startsAt.localeCompare(b.startsAt));
}

/**
 * The row J (+1) or K (-1) moves to among `count` rows. It starts from the focused row, else the open one, else the
 * top; it stops at the ends. Undefined when there are no rows.
 */
export function nextRowIndex(count: number, focused: number, open: number, step: 1 | -1): number | undefined {
  if (count === 0) return undefined;
  const at = focused !== -1 ? focused : open;
  return at === -1 ? 0 : Math.min(count - 1, Math.max(0, at + step));
}
