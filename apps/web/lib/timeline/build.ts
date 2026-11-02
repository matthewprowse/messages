// The client timeline's logic: merge every source newest first, cut the merge where messages have not been paged in yet, filter
// by type, search and matter, and group by day. Pure; the hook in use-timeline.ts feeds it.

import type { TimelineItem, TimelineType } from "./types";

/** Newest first; items at the same moment keep a stable order by key. */
export function mergeNewestFirst(lists: TimelineItem[][]): TimelineItem[] {
  return lists.flat().sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
}

/** The oldest message time among these, or null with none. */
export function oldestMessage(items: TimelineItem[]): string | null {
  let oldest: string | null = null;
  for (const i of items) if (i.type === "message" && (oldest === null || i.at < oldest)) oldest = i.at;
  return oldest;
}

/**
 * Messages are paged in newest first, so older things (a meeting from last year) must wait for the page that reaches them, or the
 * timeline would show a meeting with no messages around it. While more messages remain, anything older than the oldest loaded
 * message is held back; once they are all in, everything shows.
 */
export function visibleWindow(sorted: TimelineItem[], messagesDone: boolean): TimelineItem[] {
  const oldest = oldestMessage(sorted);
  if (messagesDone || !oldest) return sorted;
  return sorted.filter((i) => i.at >= oldest);
}

export interface TimelineFilter {
  /** Types to show; an empty set shows all. */
  types: ReadonlySet<TimelineType>;
  /** Searched in the title and the detail, case blind. */
  term: string;
  /** When set, only items that belong to this set of matter refs. */
  matterRefs?: ReadonlySet<string> | null;
}

/** The items that pass the filter, order kept. */
export function filterTimeline(items: TimelineItem[], f: TimelineFilter): TimelineItem[] {
  const term = f.term.trim().toLowerCase();
  return items.filter((i) => {
    if (f.types.size > 0 && !f.types.has(i.type)) return false;
    if (f.matterRefs && !i.refs.some((r) => f.matterRefs!.has(r))) return false;
    if (term && !`${i.title} ${i.detail ?? ""}`.toLowerCase().includes(term)) return false;
    return true;
  });
}

/** How many items there are of each type, for the filter's counts. */
export function countByType(items: TimelineItem[]): Map<TimelineType, number> {
  const out = new Map<TimelineType, number>();
  for (const i of items) out.set(i.type, (out.get(i.type) ?? 0) + 1);
  return out;
}

export interface DayGroup { day: string; label: string; items: TimelineItem[] }

/** The local calendar day of a moment, as YYYY-MM-DD. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "Today", "Yesterday", else "Fri 6 Nov" (with the year when it is not this year). */
export function dayLabel(day: string, now: Date): string {
  if (day === localDay(now.toISOString())) return "Today";
  if (day === localDay(new Date(now.getTime() - 86_400_000).toISOString())) return "Yesterday";
  const d = new Date(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

/** Newest-first items as one group per local day, in the same order. */
export function groupByDay(items: TimelineItem[], now: Date): DayGroup[] {
  const out: DayGroup[] = [];
  for (const i of items) {
    const day = localDay(i.at);
    const last = out[out.length - 1];
    if (last?.day === day) last.items.push(i);
    else out.push({ day, label: dayLabel(day, now), items: [i] });
  }
  return out;
}
