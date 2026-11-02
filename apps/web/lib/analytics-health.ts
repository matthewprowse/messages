// The Health tab reads analytics_health (supabase/migrations/20261117132000_analytics_health.sql): activation from
// signup, retention by signup week, weekly active people, churn, value delivered and channel mix. It is worked out from
// the per user per day rollups and the account and signup tables, not from the window the Usage tab picks. The function
// returns jsonb, so the shape is written out here and parseHealth fills in anything missing.

import { AnalyticsError } from "./analytics-data";

export interface HealthStep {
  key: string;
  users: number;
  /** Median seconds from signup to this step, over the people who reached it with a known time. */
  p50_secs: number | null;
}

export interface HealthRetention {
  /** ISO date of the Monday of the signup week. */
  start: string;
  size: number;
  /** Entry k: how many of the group were active (or valued) k + 1 weeks after the signup week. */
  later_active: number[];
  later_valued: number[];
}

export interface HealthValue {
  active: number;
  replies: number;
  drafts_sent: number;
  triaged: number;
  junk_cleared: number;
}

export interface HealthChurn {
  user: string;
  last_seen: string;
  signed_up: string;
  accounts: number;
  account_error: boolean;
  drafts_sent: number;
  ai_cost_micro: number;
}

export interface Health {
  as_of: string;
  measured: number;
  sharing_off: number;
  signups: { week: string; n: number }[];
  funnel: { cohort: number; steps: HealthStep[] };
  first_draft: { week: string; signups: number; sent: number; p50_secs: number | null; p90_secs: number | null }[];
  retention: HealthRetention[];
  weekly: { week: string; active: number; valued: number }[];
  stickiness: { wau: number; mau: number; dau_avg: number; resurrected: number; curve: { days: number; users: number }[] };
  churn: HealthChurn[];
  value: { now: HealthValue; before: HealthValue };
  channels: { mix: string; users: number; active_7d: number; valued_28d: number }[];
}

const NO_VALUE: HealthValue = { active: 0, replies: 0, drafts_sent: 0, triaged: 0, junk_cleared: 0 };

/** The jsonb from the database as a Health, with anything missing filled in so the tab never reads past the end of it. */
export function parseHealth(raw: unknown): Health {
  const j = (raw && typeof raw === "object" ? raw : {}) as Partial<Health>;
  return {
    as_of: j.as_of ?? "",
    measured: j.measured ?? 0,
    sharing_off: j.sharing_off ?? 0,
    signups: j.signups ?? [],
    funnel: { cohort: j.funnel?.cohort ?? 0, steps: j.funnel?.steps ?? [] },
    first_draft: j.first_draft ?? [],
    retention: (j.retention ?? []).map((r) => ({ ...r, later_active: r.later_active ?? [], later_valued: r.later_valued ?? [] })),
    weekly: j.weekly ?? [],
    stickiness: { wau: 0, mau: 0, dau_avg: 0, resurrected: 0, curve: [], ...(j.stickiness ?? {}) },
    churn: j.churn ?? [],
    value: { now: { ...NO_VALUE, ...(j.value?.now ?? {}) }, before: { ...NO_VALUE, ...(j.value?.before ?? {}) } },
    channels: j.channels ?? [],
  };
}

/** The Health numbers as of now. Only the owner account may call it. `exclude` leaves out the owner and the test accounts. */
export async function loadHealth(exclude = false): Promise<Health> {
  const { supabase } = await import("./supabase");
  const { data, error } = await supabase.rpc("analytics_health", { p_to: new Date().toISOString(), p_exclude: exclude });
  if (error) throw new AnalyticsError(error.code === "42501" ? "denied" : "failed");
  return parseHealth(data);
}
