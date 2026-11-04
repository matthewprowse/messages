// The AI Budget form and the AI Usage summary, as plain functions so the rules can be tested without a page: what makes the
// form invalid (in words), how a save keeps the share keys the form does not show, which saves would pause a feature for
// everyone, whether the Gemini billing breaker is currently tripped, and the month total and its projection.

import { AI_FEATURES } from "./ai-features";

export type LimitKey = "regen_per_hour" | "auto_drafts_per_day" | "summaries_per_day" | "flag_multiple" | "flag_day_usd";
export const LIMITS: { key: LimitKey; title: string; description: string; unit: string; whole?: boolean; max: number }[] = [
  { key: "regen_per_hour", title: "Drafts per Conversation per Hour", description: "Drafts, regenerations and voice drafts a person can ask for in one conversation in an hour.", unit: "Drafts", whole: true, max: 1000 },
  { key: "auto_drafts_per_day", title: "Automatic Drafts per Conversation per Day", description: "Drafts made without being asked, for one conversation in a day.", unit: "Drafts", whole: true, max: 1000 },
  { key: "summaries_per_day", title: "Contact Summaries per Day", description: "Contact and company summaries learned for one person in a day. A large import catches up over several days.", unit: "Summaries", whole: true, max: 100000 },
  { key: "flag_multiple", title: "Flag Above Middle Person", description: "Flag an account whose month, shared across its team's seats, is this many times the middle seat's, and over $1.", unit: "Times", max: 1000 },
  { key: "flag_day_usd", title: "Flag Above Daily Amount", description: "Flag an account that uses more than this in one day, setup included.", unit: "$", max: 1000 },
];

/** The form's values as typed. */
export interface BudgetForm {
  monthly: string;
  shares: Record<string, string>;
  weeklyPct: string;
  weekly: string[];
  setupUsd: string;
  setupDays: string;
  limits: Record<LimitKey, string>;
}

const num = (s: string) => (s.trim() === "" ? Number.NaN : Number(s));

/** The shares column as numbers. Anything that is not a finite number is dropped. */
export function sharesOf(json: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (json && typeof json === "object" && !Array.isArray(json)) for (const [k, v] of Object.entries(json)) if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  return out;
}

/** The share keys the database has that this page has no row for. They are kept as they are on save, never zeroed. */
export function unknownShares(original: Record<string, number>): Record<string, number> {
  const known = new Set(AI_FEATURES.map((f) => f.key));
  return Object.fromEntries(Object.entries(original).filter(([k]) => !known.has(k)));
}

/** The shares to save: everything that was there, with the edited features on top. */
export function mergeShares(original: Record<string, number>, edited: Record<string, number>): Record<string, number> {
  return { ...original, ...edited };
}

/** The sum of every share, the unknown ones included, as enforcement counts it. */
export function shareTotal(form: BudgetForm, original: Record<string, number>): number {
  const extra = Object.values(unknownShares(original)).reduce((n, v) => n + v, 0);
  return AI_FEATURES.reduce((n, f) => n + num(form.shares[f.key] ?? ""), extra);
}

/** Fields that fail on their own, so the row can be marked invalid. */
export function badFields(form: BudgetForm): Set<string> {
  const bad = new Set<string>();
  const monthly = num(form.monthly);
  if (!(monthly > 0 && monthly <= 1000)) bad.add("monthly");
  for (const f of AI_FEATURES) {
    const v = num(form.shares[f.key] ?? "");
    if (!(Number.isFinite(v) && v >= 0 && v <= 100)) bad.add(`share:${f.key}`);
  }
  const week = num(form.weeklyPct);
  if (!(week > 0 && week <= 100)) bad.add("weeklyPct");
  const setup = num(form.setupUsd);
  if (!(Number.isFinite(setup) && setup >= 0 && setup <= 1000)) bad.add("setupUsd");
  const days = num(form.setupDays);
  if (!(Number.isInteger(days) && days >= 1 && days <= 60)) bad.add("setupDays");
  for (const x of LIMITS) {
    const v = num(form.limits[x.key]);
    if (!(Number.isFinite(v) && v >= 1 && v <= x.max && (!x.whole || Number.isInteger(v)))) bad.add(`limit:${x.key}`);
  }
  return bad;
}

/** The first thing wrong with the form, in words for the person, or null. Shown beside a disabled Save. */
export function budgetProblem(form: BudgetForm, original: Record<string, number>): string | null {
  const bad = badFields(form);
  if (bad.has("monthly")) return "Monthly Budget per Seat must be more than $0 and at most $1,000.";
  for (const f of AI_FEATURES) if (bad.has(`share:${f.key}`)) return `${f.label} must be a share from 0 to 100.`;
  const total = shareTotal(form, original);
  if (Math.round(total * 100) !== 10000) return `The shares add up to ${Math.round(total * 10) / 10}%, not 100%.`;
  if (bad.has("weeklyPct")) return "Weekly Limit must be more than 0% and at most 100%.";
  if (bad.has("setupUsd")) return "Setup Allowance must be from $0 to $1,000.";
  if (bad.has("setupDays")) return "Setup Period must be a whole number of days from 1 to 60.";
  for (const x of LIMITS) if (bad.has(`limit:${x.key}`)) return `${x.title} must be ${x.whole ? "a whole number" : "a number"} from 1 to ${x.max.toLocaleString("en-US")}.`;
  return null;
}

/** Features whose share goes from something to zero: a zero share pauses the feature for everyone until it is raised. */
export function zeroedFeatures(original: Record<string, number>, next: Record<string, number>): string[] {
  return Object.keys(next).filter((k) => (original[k] ?? 0) > 0 && next[k] === 0);
}

/** A stable string of everything the form holds, to tell whether it differs from what was saved. */
export function formSnapshot(form: BudgetForm): string {
  return JSON.stringify([form.monthly.trim(), AI_FEATURES.map((f) => (form.shares[f.key] ?? "").trim()), form.weeklyPct.trim(), [...form.weekly].sort(), form.setupUsd.trim(), form.setupDays.trim(), LIMITS.map((x) => form.limits[x.key].trim())]);
}

/** ai_status as the page reads it. */
export interface BillingRow { billing_paused_since: string | null; billing_checked_at: string | null }

// The AI worker rewrites the row at least every trip window (10 minutes) while billing is failing, so a row older than two
// windows is from a worker that died while tripped, not a pause that is still on.
const STALE_MS = 25 * 60 * 1000;

/** Whether Gemini billing is paused right now, and since when. */
export function billingState(row: BillingRow | null, now: number): { paused: boolean; since: string | null } {
  if (!row?.billing_paused_since || !row.billing_checked_at) return { paused: false, since: null };
  const checked = Date.parse(row.billing_checked_at);
  if (!Number.isFinite(checked) || now - checked > STALE_MS) return { paused: false, since: null };
  return { paused: true, since: row.billing_paused_since };
}

/** The month's total so far carried to the end of the month at the pace so far. Null in the first day, too early to say. */
export function projectMonth(total: number, now: Date): number | null {
  const day = now.getUTCDate() - 1 + now.getUTCHours() / 24;
  if (day < 1) return null;
  const days = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  return (total / day) * days;
}

export interface UsageSummaryRow { month_usd: number; setup_usd?: number; flag: string | null; paused: string[] }

/**
 * The strip at the top of AI Usage: spend, flagged accounts, people with a feature paused, and how many people per feature.
 * The spend is the whole bill so far, setup work included, so it agrees with the AI view's month card.
 */
export function usageSummary(rows: UsageSummaryRow[]): { total: number; flagged: number; paused: number; byFeature: [string, number][] } {
  const byFeature = new Map<string, number>();
  for (const r of rows) for (const f of r.paused) byFeature.set(f, (byFeature.get(f) ?? 0) + 1);
  return {
    total: rows.reduce((n, r) => n + r.month_usd + (r.setup_usd ?? 0), 0),
    flagged: rows.filter((r) => r.flag).length,
    paused: rows.filter((r) => r.paused.length > 0).length,
    byFeature: [...byFeature.entries()].sort((a, b) => b[1] - a[1]),
  };
}
