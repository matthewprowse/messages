"use client";

// Admin view of AI spend: a strip on top (Gemini billing, the month's total and where it is heading, who is flagged or paused),
// then each account with month, week and day in dollars, calls, its share of the budget and a flag when it stands out.
// Loaded from Supabase; shows cost figures only, never message content.

import { useCallback, useEffect, useState } from "react";
import { Gauge, TriangleAlert } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { featureLabel, spend } from "@/lib/ai-features";
import { billingState, projectMonth, usageSummary, type BillingRow } from "@/lib/admin-budget";
import { EmptyState, providerLabel } from "@/components/primitives";
import { AdminHeading, AdminRow } from "@/components/admin/parts";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

type Row = {
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

const labelOf = (p: string) => (providerLabel as Record<string, string>)[p] ?? p;
const since = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Stat({ label, value, note, alert }: { label: string; value: string; note?: string; alert?: boolean }) {
  return (
    <div className="min-w-32 flex-1 rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={alert ? "text-sm font-medium text-destructive" : "text-sm font-medium"}>{value}</div>
      {note && <div className="text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}

/** What each person has used this month, in dollars, for the owner. Flagged accounts are marked; a flag blocks nothing. */
export function AiUsage({ version, onBusy, onAttention }: { version: number; onBusy: (busy: boolean) => void; onAttention: (count: number) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [billing, setBilling] = useState<BillingRow | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    onBusy(true);
    setFailed(false);
    const [usage, status] = await Promise.all([supabase.rpc("ai_usage_by_user"), supabase.from("ai_status").select("billing_paused_since, billing_checked_at").maybeSingle()]);
    if (usage.error) setFailed(true);
    else setRows((usage.data ?? []) as unknown as Row[]);
    setBilling(status.data ?? null);
    onBusy(false);
  }, [onBusy]);
  useEffect(() => { void load(); }, [load, version]);

  const now = new Date();
  const state = billingState(billing, now.getTime());
  const sum = rows ? usageSummary(rows) : null;
  const projected = sum ? projectMonth(sum.total, now) : null;
  // Billing paused, then flagged accounts and paused people: what the tab badge counts.
  const attention = (state.paused ? 1 : 0) + (sum ? sum.flagged + sum.paused : 0);
  useEffect(() => { onAttention(attention); }, [attention, onAttention]);

  return (
    <div className="flex flex-col gap-3">
      {state.paused && (
        <div role="alert" className="mx-3 flex items-start gap-2 rounded-lg border border-destructive/50 p-3 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>Gemini billing is paused{state.since ? ` since ${since(state.since)}` : ""}. Every AI feature is stopped until billing works again; the AI worker tries again every 10 minutes.</span>
        </div>
      )}
      {sum && (
        <div className="flex flex-wrap gap-3 px-3">
          <Stat label="Gemini Billing" value={state.paused ? "Paused" : "OK"} alert={state.paused} />
          <Stat label="This Month" value={spend(sum.total)} note={projected == null ? undefined : `About ${spend(projected)} by month end`} />
          <Stat label="Flagged" value={String(sum.flagged)} alert={sum.flagged > 0} />
          <Stat label="Paused People" value={String(sum.paused)} alert={sum.paused > 0} note={sum.byFeature.map(([k, n]) => `${featureLabel(k)} ${n}`).join(", ") || undefined} />
        </div>
      )}
      <AdminHeading
        title="AI Usage by Person"
        description="What each person has used this month in dollars. This month and this week leave out setup work, which is shown separately. A team's percent is the whole team's spend over its seats times the budget, the same as the pause. Flagged accounts passed the amounts set under AI Budget; nothing is blocked by a flag."
      />
      {failed ? (
        <EmptyState icon={Gauge} title="Could Not Load AI Usage" description="Check your connection and refresh." />
      ) : rows === null ? (
        <div className="flex flex-col gap-3"><Skeleton className="h-16 w-full rounded-lg" /><Skeleton className="h-16 w-full rounded-lg" /></div>
      ) : rows.length === 0 ? (
        <div className="py-12"><EmptyState icon={Gauge} title="No AI Use Yet" description="No AI use this month yet." /></div>
      ) : (
        <div>
          {rows.map((r, i) => {
            const features = Object.entries(r.by_feature).filter((e): e is [string, number] => e[1] != null).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${featureLabel(k)} ${spend(v)}`).join(", ");
            return (
              <div key={r.user_id}>
                {i > 0 && <Separator className="ml-3" />}
                <AdminRow
                  title={<>{r.email ?? r.user_id.slice(0, 8)}{r.flag && <Badge variant="destructive">{r.flag}</Badge>}{r.paused.map((f) => <Badge key={f} variant="outline">{featureLabel(f)} Paused</Badge>)}</>}
                  description={
                    <>
                      <div>{r.team_name ? `${r.team_name}, ${r.team_seats} seats. ` : ""}{r.accounts.length > 0 ? r.accounts.map(labelOf).join(", ") : "No accounts connected"}</div>
                      <div>Week {spend(r.week_usd)}, Today {spend(r.day_usd)}, Setup {spend(r.setup_usd)}, {r.calls.toLocaleString()} Calls{features ? `, ${features}` : ""}</div>
                    </>
                  }
                >
                  <div className="w-28 text-right">
                    <div className="text-sm font-medium tabular-nums">{spend(r.month_usd)}</div>
                    <Progress value={Math.min(100, r.month_pct)} aria-label="Share of the budget used this month" className="my-1" />
                    <div className="text-xs text-muted-foreground tabular-nums">{Math.round(r.month_pct)}% {r.team_name ? "of Team" : "This Month"}</div>
                  </div>
                </AdminRow>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
