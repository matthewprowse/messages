// The owner-operator rules behind Admin's Health, Connectors, AI History, Alerts and Audit sections, as plain functions so the
// thresholds and the arithmetic can be tested without a page. Everything here is a count, an age, a code or a dollar amount:
// nothing about message content, names or addresses ever reaches it.

export type Level = "green" | "amber" | "red";

export interface LeaseRow { name: string; expires_in_s: number }
export interface QueueRow { key: string; depth: number; oldest_age_s: number | null }
export interface Health { at: string; leases: LeaseRow[]; queues: QueueRow[] }

/** Every queue Admin watches: its name, and how long its oldest waiting row may wait before amber and red (seconds). */
export const QUEUES: { key: string; label: string; amberS: number; redS: number }[] = [
  { key: "outbox", label: "Outbox, Waiting to Send", amberS: 120, redS: 600 },
  { key: "outbox_sending", label: "Outbox, Sending Now", amberS: 300, redS: 900 },
  { key: "drafts", label: "Drafts Waiting", amberS: 300, redS: 1800 },
  { key: "mail_actions", label: "Mail Actions", amberS: 300, redS: 1800 },
  { key: "task_updates", label: "Task Updates", amberS: 300, redS: 1800 },
  { key: "calendar_outbox", label: "Calendar Writes", amberS: 300, redS: 1800 },
  { key: "automation_previews", label: "Automation Previews", amberS: 600, redS: 3600 },
  { key: "ai_batches", label: "AI Batches in Flight", amberS: 12 * 3600, redS: 26 * 3600 }, // Google answers within 24 hours
];

/** The AI worker's lease name (apps/ai/ai/lease.py); the sync worker's are shard-0, shard-1 and so on. */
export const AI_LEASE = "ai";

export const queueLabel = (key: string) => QUEUES.find((q) => q.key === key)?.label ?? key;

/** A queue is green when empty or young, amber when its oldest row has waited past the amber time, red past the red time. */
export function queueLevel(row: QueueRow): Level {
  const rule = QUEUES.find((q) => q.key === row.key);
  if (!rule || row.depth <= 0 || row.oldest_age_s == null) return "green";
  if (row.oldest_age_s >= rule.redS) return "red";
  if (row.oldest_age_s >= rule.amberS) return "amber";
  return "green";
}

/** A lease is renewed every 30 s for 90 s: under 30 s left means a renewal was missed, and 0 means the worker is gone. */
export function leaseLevel(lease: LeaseRow): Level {
  if (lease.expires_in_s <= 0) return "red";
  if (lease.expires_in_s < 30) return "amber";
  return "green";
}

const ORDER: Level[] = ["green", "amber", "red"];
/** The worst of several levels; green for none. */
export const worst = (levels: Level[]): Level => levels.reduce<Level>((a, b) => (ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a), "green");

/** "45 s", "12 min", "3 h", "2 d"; "None" for no value. */
export function ageText(seconds: number | null | undefined): string {
  if (seconds == null) return "None";
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return `${s} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 129600) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

/** The sync workers' leases (shard-N) and the AI worker's, split apart. */
export function splitLeases(leases: LeaseRow[]): { shards: LeaseRow[]; ai: LeaseRow | null } {
  return { shards: leases.filter((l) => l.name !== AI_LEASE), ai: leases.find((l) => l.name === AI_LEASE) ?? null };
}

// Connectors

export interface AccountGroup { provider: string; status: string; n: number; freshest_age_s: number | null; stalest_age_s: number | null }
export interface ErrorCode { event: string; provider: string; code: string; n: number }
export interface ConnectorHealth { at: string; accounts: AccountGroup[]; errors: ErrorCode[] }

/** A connected account whose last good sync is older than this is amber, and red past the second. Mail is checked every 15 minutes at worst. */
export const SYNC_AMBER_S = 3600;
export const SYNC_RED_S = 6 * 3600;

export interface ProviderSummary { provider: string; total: number; connected: number; error: number; other: number; stalestS: number | null; level: Level }

/** One line per provider: how many accounts, how many connected or in error, and how stale the stalest connected one is. */
export function providerSummaries(groups: AccountGroup[]): ProviderSummary[] {
  const by = new Map<string, ProviderSummary>();
  for (const g of groups) {
    const s = by.get(g.provider) ?? { provider: g.provider, total: 0, connected: 0, error: 0, other: 0, stalestS: null, level: "green" as Level };
    s.total += g.n;
    if (g.status === "connected") {
      s.connected += g.n;
      if (g.stalest_age_s != null) s.stalestS = Math.max(s.stalestS ?? 0, g.stalest_age_s);
    } else if (g.status === "error") s.error += g.n;
    else s.other += g.n;
    by.set(g.provider, s);
  }
  for (const s of by.values()) {
    const sync: Level = s.stalestS == null ? "green" : s.stalestS >= SYNC_RED_S ? "red" : s.stalestS >= SYNC_AMBER_S ? "amber" : "green";
    const errors: Level = s.error === 0 ? "green" : s.connected === 0 ? "red" : "amber";
    s.level = worst([sync, errors]);
  }
  return [...by.values()].sort((a, b) => a.provider.localeCompare(b.provider));
}

/** Error codes added up across events, per provider and code, biggest first. */
export function errorTotals(errors: ErrorCode[]): { provider: string; code: string; n: number }[] {
  const by = new Map<string, { provider: string; code: string; n: number }>();
  for (const e of errors) {
    const key = `${e.provider}\u0000${e.code}`;
    const cur = by.get(key) ?? { provider: e.provider, code: e.code, n: 0 };
    cur.n += e.n;
    by.set(key, cur);
  }
  return [...by.values()].sort((a, b) => b.n - a.n || a.code.localeCompare(b.code));
}

// AI history

export interface DayRow { user_id: string; email: string | null; day: string; usd: number }
export interface MonthRow { user_id: string; email: string | null; month: string; usd: number }
export interface FeatureRow { user_id: string; feature: string; usd: number }
export interface History { at: string; daily: DayRow[]; monthly: MonthRow[]; features: FeatureRow[] }

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** The last `days` days (UTC, oldest first) of one person's spend, with 0 for a day without calls. */
export function sparkSeries(daily: DayRow[], userId: string, now: Date, days = 30): number[] {
  const by = new Map<string, number>();
  for (const r of daily) if (r.user_id === userId) by.set(r.day, (by.get(r.day) ?? 0) + r.usd);
  const out: number[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(by.get(dayKey(new Date(now.getTime() - i * 86_400_000))) ?? 0);
  return out;
}

/** An SVG polyline path for a series in a w by h box, the tallest value touching the top. A flat zero series is a line along the bottom. */
export function sparkPath(values: number[], w: number, h: number): string {
  if (values.length === 0) return "";
  const max = Math.max(...values, 0);
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  return values.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)} ${(max === 0 ? h : h - (v / max) * h).toFixed(1)}`).join(" ");
}

export interface PersonHistory {
  userId: string;
  email: string | null;
  series: number[];
  total30: number;
  today: number;
  months: { month: string; usd: number }[];
  /** This month so far against last month, as a percent; null when last month was nothing. Partial months read low early on. */
  monthChangePct: number | null;
  features: { feature: string; usd: number }[];
}

/** Every person with spend, biggest 30 day total first. */
export function personHistories(h: History, now: Date): PersonHistory[] {
  const ids = new Set<string>([...h.daily.map((r) => r.user_id), ...h.monthly.map((r) => r.user_id)]);
  const today = dayKey(now);
  const thisMonth = today.slice(0, 7);
  const lastMonth = dayKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))).slice(0, 7);
  const people: PersonHistory[] = [];
  for (const userId of ids) {
    const series = sparkSeries(h.daily, userId, now);
    const months = h.monthly.filter((r) => r.user_id === userId).map((r) => ({ month: r.month.slice(0, 7), usd: r.usd })).sort((a, b) => a.month.localeCompare(b.month));
    const now$ = months.find((m) => m.month === thisMonth)?.usd ?? 0;
    const before$ = months.find((m) => m.month === lastMonth)?.usd ?? 0;
    people.push({
      userId,
      email: h.daily.find((r) => r.user_id === userId)?.email ?? h.monthly.find((r) => r.user_id === userId)?.email ?? null,
      series,
      total30: series.reduce((a, b) => a + b, 0),
      today: series[series.length - 1] ?? 0,
      months,
      monthChangePct: before$ > 0 ? ((now$ - before$) / before$) * 100 : null,
      features: h.features.filter((f) => f.user_id === userId).sort((a, b) => b.usd - a.usd).map(({ feature, usd }) => ({ feature, usd })),
    });
  }
  return people.sort((a, b) => b.total30 - a.total30 || (a.email ?? "").localeCompare(b.email ?? ""));
}

/** Spend today (UTC) across everyone, from the daily rows. */
export const spendToday = (daily: DayRow[], now: Date): number => daily.filter((r) => r.day === dayKey(now)).reduce((a, r) => a + r.usd, 0);

/** Month by month across everyone, oldest first, for the total line. */
export function monthTotals(monthly: MonthRow[]): { month: string; usd: number }[] {
  const by = new Map<string, number>();
  for (const r of monthly) by.set(r.month.slice(0, 7), (by.get(r.month.slice(0, 7)) ?? 0) + r.usd);
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, usd]) => ({ month, usd }));
}

// Alerts

export interface Alert { id: string; level: Exclude<Level, "green">; title: string; detail: string }

export interface AlertInput {
  health: Health | null;
  billingPausedSince: string | null;
  unpricedModels: string[];
  todayUsd: number | null;
  dailyLimitUsd: number | null;
}

/**
 * What needs the owner now, worst first: Gemini billing paused, a lease run out (or the AI worker holding none), daily AI
 * spend past the limit set in Admin (amber from 80%), a configured model with no price, and a queue that is stuck. Worked
 * out in the page from the same data the other sections show, so the thresholds live in one place (this file).
 */
export function buildAlerts(i: AlertInput): Alert[] {
  const out: Alert[] = [];
  if (i.billingPausedSince) out.push({ id: "billing", level: "red", title: "Gemini Billing Is Paused", detail: "Every AI feature is stopped until billing works again. The AI worker tries again every 10 minutes." });
  if (i.health) {
    for (const l of i.health.leases) {
      const level = leaseLevel(l);
      if (level === "red") out.push({ id: `lease-${l.name}`, level, title: `Lease Expired, ${l.name}`, detail: l.name === AI_LEASE ? "The AI worker is not renewing its lease. It may have stopped." : "A sync worker is not renewing its lease. It may have stopped." });
    }
    if (!i.health.leases.some((l) => l.name === AI_LEASE)) out.push({ id: "lease-ai-missing", level: "amber", title: "No AI Worker Lease", detail: "No AI worker holds a lease. It is stopped, or the lease migration is not applied." });
    for (const q of i.health.queues) {
      const level = queueLevel(q);
      if (level !== "green") out.push({ id: `queue-${q.key}`, level, title: `Queue Stuck, ${queueLabel(q.key)}`, detail: `${q.depth} waiting, the oldest for ${ageText(q.oldest_age_s)}.` });
    }
  }
  if (i.todayUsd != null && i.dailyLimitUsd != null && i.dailyLimitUsd > 0) {
    if (i.todayUsd >= i.dailyLimitUsd) out.push({ id: "daily-spend", level: "red", title: "Daily AI Spend Is Over the Limit", detail: `$${i.todayUsd.toFixed(2)} so far today, against a limit of $${i.dailyLimitUsd.toFixed(2)}.` });
    else if (i.todayUsd >= i.dailyLimitUsd * 0.8) out.push({ id: "daily-spend", level: "amber", title: "Daily AI Spend Is Near the Limit", detail: `$${i.todayUsd.toFixed(2)} so far today, against a limit of $${i.dailyLimitUsd.toFixed(2)}.` });
  }
  for (const m of i.unpricedModels) out.push({ id: `price-${m}`, level: "amber", title: "Model Has No Price", detail: `${m} is billed at the dearest known price until pricing.py has an entry for it.` });
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "red" ? -1 : 1));
}

// Audit

export const AUDIT_LABELS: Record<string, string> = {
  budget_saved: "AI Budget Saved",
  flag_changed: "Switch Changed",
  setting_changed: "Setting Changed",
  request_decided: "Request Decided",
  team_created: "Team Created",
  seats_changed: "Seats Changed",
};

/** The fields that differ between the old and the new value of an audit row, as short text. A null side (a new team) lists the new side whole. */
export function auditChanges(oldValue: unknown, newValue: unknown): { key: string; from: string; to: string }[] {
  const o = isObject(oldValue) ? oldValue : {};
  const n = isObject(newValue) ? newValue : {};
  const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])].sort();
  return keys.filter((k) => JSON.stringify(o[k]) !== JSON.stringify(n[k])).map((key) => ({ key, from: show(o[key]), to: show(n[key]) }));
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const show = (v: unknown): string => (v === undefined || v === null ? "None" : typeof v === "string" ? v : JSON.stringify(v));
