"use client";

// Admin's AI spend this month, from use-ai-usage.ts: the billing numbers Overview shows (Gemini billing, the month so far
// and where it is heading, who is flagged or paused) and the AI view's card of each person (the top five, everyone in See All)
// with month, week and day in dollars, calls and their share of the budget. Cost figures only, never message content.

import { TriangleAlert, User } from "lucide-react";
import { featureLabel, spend } from "@/lib/ai-features";
import { projectMonth } from "@/lib/admin-budget";
import { providerLabel } from "@/components/primitives";
import { Card, IconCircle, Row } from "@/components/surface";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { when } from "./format";
import { Failed, LoadingCard, Quiet, Stat, Stats } from "./parts";
import { TopRows } from "./top-rows";
import type { AiUsageState } from "./use-ai-usage";

const labelOf = (p: string) => (providerLabel as Record<string, string>)[p] ?? p;

/** Overview's billing card: the state of Gemini billing and the month's spend, flags and pauses as number cards. */
export function BillingStats({ usage }: { usage: AiUsageState }) {
  const { billing, summary: sum } = usage;
  const projected = sum ? projectMonth(sum.total, new Date()) : null;
  // A failed load would otherwise leave the cards loading for ever.
  const gone = usage.failed && !sum ? "No Data" : undefined;
  return (
    <>
      {billing.paused && (
        <Alert variant="destructive" className="bg-background">
          <TriangleAlert />
          <AlertTitle>Gemini Billing Is Paused{billing.since ? ` Since ${when(billing.since)}` : ""}</AlertTitle>
          <AlertDescription>Every AI feature is stopped. The AI worker tries again every 10 minutes.</AlertDescription>
        </Alert>
      )}
      <Stats>
        <Stat label="Gemini Billing" value={usage.rows || usage.failed ? (billing.paused ? "Paused" : "OK") : undefined} alert={billing.paused} />
        <Stat label="AI Spend This Month" value={sum ? spend(sum.total) : gone} note={projected == null ? undefined : `About ${spend(projected)} By Month End`} />
        <Stat label="Flagged" value={sum?.flagged ?? gone} alert={!!sum?.flagged} />
        <Stat label="Paused People" value={sum?.paused ?? gone} alert={!!sum?.paused} note={sum?.byFeature.map(([k, n]) => `${featureLabel(k)} ${n}`).join(", ") || undefined} />
      </Stats>
    </>
  );
}

/**
 * Each person's month, the five biggest on the page and everyone in See All, where each row also has its week, today and
 * feature split. Flagged accounts are marked, and a flag blocks nothing. A team's percent is the whole team's, as the
 * pause counts it.
 */
export function AiUsage({ usage }: { usage: AiUsageState }) {
  const { rows, failed } = usage;
  if (failed) return <Failed title="Could Not Load AI Usage" />;
  if (rows === null) return <LoadingCard title="By Person, This Month" />;
  if (rows.length === 0) return <Card title="By Person, This Month"><Quiet>No AI Use This Month Yet</Quiet></Card>;
  // The amount is the whole month, setup included, so it matches the month card; the bar is the budget share, which
  // leaves setup out as enforcement does.
  const total = (r: (typeof rows)[number]) => r.month_usd + r.setup_usd;
  const sorted = [...rows].sort((a, b) => total(b) - total(a));
  return (
    <TopRows
      title="By Person, This Month"
      items={sorted}
      keyOf={(r) => r.user_id}
      row={(r, full) => {
        const features = Object.entries(r.by_feature).filter((e): e is [string, number] => e[1] != null).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${featureLabel(k)} ${spend(v)}`).join(", ");
        return (
          <>
            <Row
              lead={<IconCircle icon={User} />}
              title={r.email ?? r.user_id.slice(0, 8)}
              meta={spend(total(r))}
              detail={`${r.team_name ? `${r.team_name}, ${r.team_seats} Seats, ` : ""}${r.accounts.length > 0 ? r.accounts.map(labelOf).join(", ") : "No Accounts"}`}
              end={
                <div className="flex w-20 flex-col gap-1">
                  <Progress value={Math.min(100, r.month_pct)} aria-label="Share of the budget used this month" />
                  <span className="text-right text-xs tabular-nums text-muted-foreground">{Math.round(r.month_pct)}%{r.team_name ? " Of Team" : ""}</span>
                </div>
              }
            />
            {(r.flag || r.paused.length > 0) && (
              <div className="-mt-2 flex flex-wrap gap-1 pr-3 pb-3 pl-16">
                {r.flag && <Badge variant="destructive">{r.flag}</Badge>}
                {r.paused.map((f) => <Badge key={f} variant="outline">{featureLabel(f)} Paused</Badge>)}
              </div>
            )}
            {full && (
              <div className="-mt-2 flex flex-col gap-1 pr-3 pb-3 pl-16 text-xs text-muted-foreground">
                <span className="tabular-nums">Week {spend(r.week_usd)}, Today {spend(r.day_usd)}, Setup {spend(r.setup_usd)}, {r.calls.toLocaleString()} Calls</span>
                {features && <span>{features}</span>}
              </div>
            )}
          </>
        );
      }}
    />
  );
}
