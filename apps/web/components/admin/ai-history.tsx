"use client";

// Admin, AI Usage (below the per person list): spend over time. Month over month across everyone, then each person with a
// 30 day sparkline, this month against last, and the cost per feature. Email is the only identifier, as in AI Usage;
// dollars only, never message content. The arithmetic is in lib/admin-ops.ts.

import { LineChart } from "lucide-react";
import { featureLabel, spend } from "@/lib/ai-features";
import { monthTotals, personHistories, type History } from "@/lib/admin-ops";
import { EmptyState } from "@/components/primitives";
import { AdminHeading, AdminRow } from "@/components/admin/parts";
import { Sparkline } from "@/components/admin/ops-parts";
import { Separator } from "@/components/ui/separator";

const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

export function AiHistory({ history, failed }: { history: History | null; failed: boolean }) {
  if (!history) return failed ? <EmptyState icon={LineChart} title="Could Not Load AI History" description="Check your connection and refresh." /> : null;
  const now = new Date();
  const months = monthTotals(history.monthly);
  const people = personHistories(history, now);
  return (
    <div className="mt-6 flex flex-col gap-3">
      <AdminHeading title="Month over Month" description="What Google was billed for everyone, setup work included. The current month is partial." />
      {months.length === 0 ? (
        <p className="px-3 text-sm text-muted-foreground">No history yet.</p>
      ) : (
        <div className="flex flex-wrap gap-3 px-3">
          {months.map((m, i) => {
            const before = months[i - 1]?.usd;
            return (
              <div key={m.month} className="min-w-28 flex-1 rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">{monthName(m.month)}</div>
                <div className="text-sm font-medium tabular-nums">{spend(m.usd)}</div>
                {before != null && before > 0 && <div className="text-xs text-muted-foreground tabular-nums">{m.usd >= before ? "Up" : "Down"} {Math.abs(Math.round(((m.usd - before) / before) * 100))}%</div>}
              </div>
            );
          })}
        </div>
      )}
      <AdminHeading title="Spend by Person, Last 30 Days" description="One line per person, a point for each day. The percent compares this month so far with the whole of last month." />
      {people.length === 0 ? (
        <p className="px-3 text-sm text-muted-foreground">No AI use in the last 30 days.</p>
      ) : (
        <div>
          {people.map((p, i) => (
            <div key={p.userId}>
              {i > 0 && <Separator className="ml-3" />}
              <AdminRow
                title={p.email ?? p.userId.slice(0, 8)}
                description={
                  <>
                    <div>{p.features.length > 0 ? p.features.map((f) => `${featureLabel(f.feature)} ${spend(f.usd)}`).join(", ") : "No feature spend"}</div>
                    <div>{p.months.length > 0 ? p.months.map((m) => `${monthName(m.month)} ${spend(m.usd)}`).join(", ") : "No monthly totals"}{p.monthChangePct == null ? "" : `. ${p.monthChangePct >= 0 ? "Up" : "Down"} ${Math.abs(Math.round(p.monthChangePct))}% on last month so far`}</div>
                  </>
                }
              >
                <Sparkline values={p.series} label={`Daily spend for ${p.email ?? "this person"} over 30 days`} />
                <div className="w-20 text-right">
                  <div className="text-sm font-medium tabular-nums">{spend(p.total30)}</div>
                  <div className="text-xs text-muted-foreground tabular-nums">Today {spend(p.today)}</div>
                </div>
              </AdminRow>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
