// Calendar events as last loaded, by person and range of days, shared by the Calendar page, the Summary's today list and
// Your Day's week so each shows at once on a return and loads again underneath. Decrypted titles live here: memory only,
// emptied on sign out (lib/memory-cache.ts). Pure: the hooks pass in the loader, so this file never touches the network.

import type { CalendarEvent } from "./calendar";
import { createMemoryCache } from "./memory-cache";

// A few weeks and months of browsing, plus today and the week row.
export const eventsCache = createMemoryCache<CalendarEvent[]>({ max: 24 });

/** The cache key for `days` days from the local day `startKey` ("2026-11-03"). Grid loads lack guests and notes, so they are kept apart. */
export function eventsKey(userId: string, startKey: string, days: number, detailed: boolean) {
  return `${userId}|${startKey}|${days}|${detailed ? "detail" : "grid"}`;
}

const DAY_MS = 86_400_000;

/** Whether an event falls in the window loadEvents reads for [start, end): a day wider each side (all-day events sit at UTC midnight). */
export function inLoadWindow(e: Pick<CalendarEvent, "startsAt" | "endsAt">, start: Date, end: Date) {
  const from = start.getTime() - DAY_MS;
  const to = end.getTime() + DAY_MS;
  const starts = Date.parse(e.startsAt);
  return starts < to && (starts >= from || (e.endsAt !== null && Date.parse(e.endsAt) > from));
}

/**
 * The events of one range after some rows changed: `gone` ids taken out, `changed` ones put in (or replaced) when they
 * still fall in the range, in loadEvents' order (start, then id). Unchanged events keep their objects.
 */
export function patchRange(events: CalendarEvent[], changed: CalendarEvent[], gone: Iterable<string>, start: Date, end: Date): CalendarEvent[] {
  const drop = new Set(gone);
  for (const e of changed) drop.add(e.id);
  const kept = events.filter((e) => !drop.has(e.id));
  const added = changed.filter((e) => inLoadWindow(e, start, end));
  if (added.length === 0) return kept.length === events.length ? events : kept;
  return [...kept, ...added].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
