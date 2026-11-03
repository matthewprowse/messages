"use client";

// Loads what each person has spent on AI this month (ai_usage_by_user) and the Gemini billing state, once for the page, so
// Overview's billing card, the AI view's per person card and the AI count on the views never disagree. Owner only: the
// database refuses anyone else. Dollars and counts only, never message content.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { billingState, usageSummary, type BillingRow } from "@/lib/admin-budget";

/** One person's month, as ai_usage_by_user returns it. */
export type UsageRow = {
  user_id: string;
  email: string | null;
  accounts: string[];
  month_usd: number;
  week_usd: number;
  day_usd: number;
  setup_usd: number;
  calls: number;
  month_pct: number; // the whole team's month over its seats times the budget, as enforcement counts it
  by_feature: Record<string, number | null>; // null for a feature whose only spend this month was setup work
  flag: string | null;
  team_name: string | null;
  team_seats: number;
  paused: string[]; // features whose share is already used up for this person
};

export interface AiUsageState {
  rows: UsageRow[] | null;
  failed: boolean;
  billing: { paused: boolean; since: string | null };
  summary: ReturnType<typeof usageSummary> | null;
  /** Billing paused, then flagged accounts and paused people: what the AI view's count shows. */
  attention: number;
}

/** Reloads whenever `version` changes (the header Refresh). */
export function useAiUsage(version: number, onBusy: (busy: boolean) => void): AiUsageState {
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  const [billingRow, setBillingRow] = useState<BillingRow | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    onBusy(true);
    setFailed(false);
    const [usage, status] = await Promise.all([supabase.rpc("ai_usage_by_user"), supabase.from("ai_status").select("billing_paused_since, billing_checked_at").maybeSingle()]);
    if (usage.error) setFailed(true);
    else setRows((usage.data ?? []) as unknown as UsageRow[]);
    setBillingRow(status.data ?? null);
    onBusy(false);
  }, [onBusy]);
  useEffect(() => { void load(); }, [load, version]);

  return useMemo(() => {
    const billing = billingState(billingRow, Date.now());
    const summary = rows ? usageSummary(rows) : null;
    return { rows, failed, billing, summary, attention: (billing.paused ? 1 : 0) + (summary ? summary.flagged + summary.paused : 0) };
  }, [rows, failed, billingRow]);
}
