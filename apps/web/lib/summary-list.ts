// Pure pieces of the Summary list: its filters and links, which of today's events still belong on it, and where J and K
// move focus. The components in components/summary/ add React, routing and the store.

import type { CalendarEvent } from "./calendar";
import type { ListFilter } from "./types";

export const SUMMARY_BASE = "/summary";

export const FILTER_OPTIONS: { key: ListFilter; label: string }[] = [
  { key: "none", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "email", label: "Email" },
  { key: "whatsapp", label: "WhatsApp" },
];

/** The Summary link for a filter; no filter is the bare path. */
export function listHref(filter: ListFilter) {
  return filter === "none" ? SUMMARY_BASE : `${SUMMARY_BASE}?filter=${filter}`;
}

/** A filter from the address, "none" when it is missing or unknown. */
export function filterOf(raw: string | null): ListFilter {
  return raw && FILTER_OPTIONS.some((o) => o.key === raw) ? (raw as ListFilter) : "none";
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
