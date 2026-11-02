// Small shared helpers for the Analytics report builders (derive.ts for Usage, derive-ai.ts for AI): reading a group's
// properties, adding counts, tallying keys, and the period lookups on a summary. Pure; no network or React.

import type { Counted, Stat } from "@messages/analytics/stats";
import type { Summary, SummaryGroup } from "@/lib/analytics-data";

const DAY = 86_400_000;

export const str = (g: SummaryGroup, k: string) => (typeof g.props[k] === "string" ? (g.props[k] as string) : "");
export const flag = (g: SummaryGroup, k: string) => g.props[k] === true;
export const list = (g: SummaryGroup, k: string) => (Array.isArray(g.props[k]) ? (g.props[k] as unknown[]).filter((x): x is string => typeof x === "string") : []);
export const count = (gs: SummaryGroup[]) => gs.reduce((s, g) => s + g.n, 0);
export const sumOf = (gs: SummaryGroup[], key: string) => gs.reduce((s, g) => s + (g.nums[key]?.sum ?? 0), 0);
export const round1 = (n: number) => Math.round(n * 10) / 10;
export const round4 = (n: number) => Math.round(n * 10000) / 10000;
export const stat = (value: number, prev: number): Stat => ({ value, prev });

export interface Part {
  part: number;
  whole: number;
}

export function bucket(gs: SummaryGroup[], key: (g: SummaryGroup) => string): Map<string, SummaryGroup[]> {
  const m = new Map<string, SummaryGroup[]>();
  for (const g of gs) m.set(key(g), [...(m.get(key(g)) ?? []), g]);
  return m;
}

/** Keys with their counts, the most common first. */
export function tally(pairs: [string, number][]): Counted[] {
  const m = new Map<string, number>();
  for (const [k, n] of pairs) m.set(k, (m.get(k) ?? 0) + n);
  return [...m].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
}

/** One period's groups and the lookups on them. */
export function view(s: Summary, period: "now" | "before") {
  const groups = s.groups.filter((g) => g.period === period);
  return {
    named: (name: string) => groups.filter((g) => g.name === name),
    pctile: (metric: string, key = ""): { n: number; p50: number; p95: number } =>
      s.percentiles.find((p) => p.period === period && p.metric === metric && p.key === key) ?? { n: 0, p50: 0, p95: 0 },
    percentiles: (metric: string) => s.percentiles.filter((p) => p.period === period && p.metric === metric),
    /** Real people for a key of a metric (the database counts them across groups). */
    people: (metric: string, key: string): number => s.distinct_users.find((d) => d.period === period && d.metric === metric && d.key === key)?.users ?? 0,
  };
}

/** The last `days` UTC days of a summary whose end is `end` (exclusive: the start of the day after the last one shown). */
export function lastDays(end: number, days: number): string[] {
  const last = end - 1;
  return Array.from({ length: days }, (_, i) => new Date(last - (days - 1 - i) * DAY).toISOString().slice(0, 10));
}
