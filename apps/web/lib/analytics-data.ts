// The Analytics page reads one summary worked out in the database (analytics_summary, supabase/migrations/
// 20261028110400_analytics_owner_rate_summary.sql) instead of paging through every event. The function returns jsonb,
// so the shape is written out here. Counts, labels and times only, like the events themselves.

const DAY = 86_400_000;

export type Period = "now" | "before";

export interface PeriodTotals {
  users: number;
  sessions: number;
  opens: number;
  events: number;
  user_days: number;
}

export interface SummaryNum {
  n: number;
  sum: number;
  p50: number;
  p95: number;
}

/** Events with the same period, name, screen and non-numeric props (strings, yes/no, lists). Numbers are summarised in `nums`. */
export interface SummaryGroup {
  period: Period;
  name: string;
  screen: string | null;
  props: Record<string, string | boolean | string[]>;
  n: number;
  /** People within this group only: groups cannot be added up for people. */
  users: number;
  nums: Record<string, SummaryNum>;
}

export interface SummaryPercentile {
  period: Period;
  metric: string;
  key: string;
  n: number;
  p50: number;
  p95: number;
}

export interface SummaryRetention {
  weeks_ago: number;
  /** ISO date of the start of the week the group was first seen. */
  start: string;
  size: number;
  /** How many of the group were seen 1, 2, ... weeks after. */
  later: number[];
}

export interface Summary {
  from: string;
  to: string;
  mid: string;
  periods: Record<Period, PeriodTotals>;
  came_back: number;
  daily: { day: string; users: number; sessions: number }[];
  events: { day: string; name: string; n: number; users: number; sums: Record<string, number> }[];
  groups: SummaryGroup[];
  percentiles: SummaryPercentile[];
  sizes: { key: string; n: number }[];
  summaries: { opened: number; original_after: number };
  activation: { active: number; connected: number; sent_draft: number };
  retention: SummaryRetention[];
}

const NO_TOTALS: PeriodTotals = { users: 0, sessions: 0, opens: 0, events: 0, user_days: 0 };

/** The jsonb from the database as a Summary, with anything missing filled in so the page never reads past the end of it. */
export function parseSummary(raw: unknown): Summary {
  const j = (raw && typeof raw === "object" ? raw : {}) as Partial<Summary>;
  const totals = (p: Period): PeriodTotals => ({ ...NO_TOTALS, ...(j.periods?.[p] ?? {}) });
  return {
    from: j.from ?? "",
    to: j.to ?? "",
    mid: j.mid ?? "",
    periods: { now: totals("now"), before: totals("before") },
    came_back: j.came_back ?? 0,
    daily: j.daily ?? [],
    events: j.events ?? [],
    groups: (j.groups ?? []).map((g) => ({ ...g, props: g.props ?? {}, nums: g.nums ?? {} })),
    percentiles: j.percentiles ?? [],
    sizes: j.sizes ?? [],
    summaries: { opened: j.summaries?.opened ?? 0, original_after: j.summaries?.original_after ?? 0 },
    activation: { active: j.activation?.active ?? 0, connected: j.activation?.connected ?? 0, sent_draft: j.activation?.sent_draft ?? 0 },
    retention: j.retention ?? [],
  };
}

/** "denied": not the owner (the database refuses with 42501). "failed": anything else. */
export class AnalyticsError extends Error {
  constructor(readonly kind: "denied" | "failed") {
    super(kind === "denied" ? "analytics are for the owner only" : "load failed");
  }
}

/**
 * The summary for the last `days` days and the `days` before them, from one call. The database splits the window at
 * the midpoint into the period shown and the one before it. Only the owner account may call it.
 */
export async function loadSummary(days: number): Promise<Summary> {
  // Loaded here so the shape and parseSummary can be used (and tested) without a browser client.
  const { supabase } = await import("./supabase");
  const to = Date.now() + 1000;
  const { data, error } = await supabase.rpc("analytics_summary", {
    p_from: new Date(to - 2 * days * DAY).toISOString(),
    p_to: new Date(to).toISOString(),
  });
  if (error) throw new AnalyticsError(error.code === "42501" ? "denied" : "failed");
  return parseSummary(data);
}
