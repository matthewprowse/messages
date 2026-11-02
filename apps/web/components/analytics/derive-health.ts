// The numbers on the Health tab, worked out from the database's analytics_health result: the activation funnel from
// signup, retention by signup week, stickiness, value delivered per active person and the channel mix. Pure; no React.

import type { Health, HealthRetention, HealthValue } from "@/lib/analytics-health";

export type ActiveMode = "active" | "valued";

export interface FunnelRow {
  key: string;
  users: number;
  /** The share of the signup cohort that reached this step, 0 to 100. */
  pct: number;
  /** Median seconds from signup; null when nobody reached it with a known time. */
  p50: number | null;
}

/** The funnel steps with the signed-up row first and each step's share of the people who signed up. */
export function funnelRows(h: Health): FunnelRow[] {
  const cohort = h.funnel.cohort;
  const share = (n: number) => (cohort === 0 ? 0 : (n / cohort) * 100);
  return [
    { key: "signed_up", users: cohort, pct: cohort === 0 ? 0 : 100, p50: 0 },
    ...h.funnel.steps.map((s) => ({ key: s.key, users: s.users, pct: share(s.users), p50: s.p50_secs })),
  ];
}

export interface RetentionRow {
  start: string;
  size: number;
  /** One entry per week that has happened since the signup week. */
  later: number[];
}

/** Retention rows for one definition of active, newest signup week first, leaving out weeks with nobody who signed up. */
export function retentionRows(h: Health, mode: ActiveMode): RetentionRow[] {
  const pick = (r: HealthRetention) => (mode === "valued" ? r.later_valued : r.later_active);
  return h.retention.filter((r) => r.size > 0).map((r) => ({ start: r.start, size: r.size, later: pick(r) })).sort((a, b) => b.start.localeCompare(a.start));
}

/** Daily active people as a share of monthly active people (0 to 100), the usual stickiness figure; 0 with no monthly people. */
export function stickinessPct(h: Health): number {
  const { dau_avg, mau } = h.stickiness;
  return mau === 0 ? 0 : Math.round((dau_avg / mau) * 1000) / 10;
}

export interface ValueRow {
  key: keyof Omit<HealthValue, "active">;
  /** Per active person over the last 7 days, and over the 7 before. */
  now: number;
  before: number;
  total: number;
}

/** What the product did per active person in the last 7 days against the 7 before: replies, drafts sent, conversations sorted, junk cleared. */
export function valueRows(h: Health): ValueRow[] {
  const per = (v: HealthValue, n: number) => (v.active === 0 ? 0 : Math.round((n / v.active) * 10) / 10);
  const keys: ValueRow["key"][] = ["replies", "drafts_sent", "triaged", "junk_cleared"];
  return keys.map((key) => ({ key, now: per(h.value.now, h.value.now[key]), before: per(h.value.before, h.value.before[key]), total: h.value.now[key] }));
}

/** The channel mix with each row's share of the people measured, and how many of them were active in the last 7 days. */
export function channelRows(h: Health): { mix: string; users: number; activePct: number; valued28d: number }[] {
  return h.channels.map((c) => ({ mix: c.mix, users: c.users, activePct: c.users === 0 ? 0 : Math.round((c.active_7d / c.users) * 100), valued28d: c.valued_28d }));
}

/** Whole weeks and days since a date, for the churn list ("12 days ago"). `now` is injected so tests do not depend on the clock. */
export function daysSince(iso: string, now: number): number {
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((now - t) / 86_400_000));
}
