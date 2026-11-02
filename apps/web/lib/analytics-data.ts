// The Usage and AI tabs read one summary worked out in the database (analytics_summary, supabase/migrations/
// 20261117133000_analytics_summary_v2.sql) instead of paging through every event. The function returns jsonb, so the shape
// is written out here. Counts, labels and times only, like the events themselves. The Health tab has its own loader
// (analytics-health.ts).

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

/** Real people for a metric key (a feature, a screen, an error): the groups cannot be added up for people. */
export interface SummaryDistinct {
  period: Period;
  metric: string;
  key: string;
  users: number;
}

/** AI cost per person over the current period, in millionths of a dollar. `top` is the five dearest, as short ids. */
export interface SummaryCostUsers {
  users: number;
  total_micro: number;
  p50_micro: number;
  p90_micro: number;
  top: { user: string; micro: number }[];
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
  distinct_users: SummaryDistinct[];
  percentiles: SummaryPercentile[];
  sizes: { key: string; n: number }[];
  summaries: { opened: number; original_after: number };
  /** Events the rate limit threw away in the current period. */
  dropped: number;
  cost_users: SummaryCostUsers;
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
    distinct_users: j.distinct_users ?? [],
    percentiles: j.percentiles ?? [],
    sizes: j.sizes ?? [],
    summaries: { opened: j.summaries?.opened ?? 0, original_after: j.summaries?.original_after ?? 0 },
    dropped: j.dropped ?? 0,
    cost_users: { users: 0, total_micro: 0, p50_micro: 0, p90_micro: 0, top: [], ...(j.cost_users ?? {}) },
  };
}

/** "denied": not the owner (the database refuses with 42501). "failed": anything else. */
export class AnalyticsError extends Error {
  constructor(readonly kind: "denied" | "failed") {
    super(kind === "denied" ? "analytics are for the owner only" : "load failed");
  }
}

/**
 * The summary for the last `days` whole UTC days (today included) and the `days` before them, from one call. The window
 * starts and ends on a day boundary, so the database's rollups and its event groupings agree. Only the owner account may
 * call it. `exclude` leaves out the owner and the test accounts.
 */
export async function loadSummary(days: number, exclude = false): Promise<Summary> {
  // Loaded here so the shape and parseSummary can be used (and tested) without a browser client.
  const { supabase } = await import("./supabase");
  const to = Math.floor(Date.now() / DAY) * DAY + DAY;
  const { data, error } = await supabase.rpc("analytics_summary", {
    p_from: new Date(to - 2 * days * DAY).toISOString(),
    p_to: new Date(to).toISOString(),
    p_exclude: exclude,
  });
  if (error) throw new AnalyticsError(error.code === "42501" ? "denied" : "failed");
  return parseSummary(data);
}
