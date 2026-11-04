"use client";

// Admin's AI view, spend over time: month over month across everyone (setup work included; the current month is partial),
// then each person with a 30 day sparkline, today and this month, and the cost per feature and month in See All. Email is the only
// identifier; dollars only, never message content. The arithmetic is in lib/admin-ops.ts.

import { User } from "lucide-react";
import { featureLabel, spend } from "@/lib/ai-features";
import { projectMonth } from "@/lib/admin-budget";
import { monthTotals, personHistories, type History } from "@/lib/admin-ops";
import { Card, IconCircle, Row } from "@/components/surface";
import { monthName } from "./format";
import { Failed, LoadingCard, Quiet, Sparkline, Stat, Stats } from "./parts";
import { TopRows } from "./top-rows";

export function AiHistory({ history, failed }: { history: History | null; failed: boolean }) {
  if (!history) return failed ? <Failed title="Could Not Load AI History" /> : <LoadingCard title="Spend By Person, Last 30 Days" />;
  const now = new Date();
  // The last four months, so the number cards stay one row.
  const all = monthTotals(history.monthly);
  const months = all.slice(-4);
  const people = personHistories(history, now);
  const thisMonth = now.toISOString().slice(0, 7);
  return (
    <>
      {months.length > 0 && (
        <Stats>
          {months.map((m, i) => {
            const before = all[all.length - months.length + i - 1]?.usd;
            // The current month is partial, so it is set against where it is heading rather than last month's whole.
            if (i === months.length - 1 && m.month === thisMonth) {
              const projected = projectMonth(m.usd, now);
              return <Stat key={m.month} label={`${monthName(m.month)} So Far`} value={spend(m.usd)} note={projected == null ? "First Day" : `About ${spend(projected)} By Month End`} />;
            }
            return <Stat key={m.month} label={monthName(m.month)} value={spend(m.usd)} note={before != null && before > 0 ? `${m.usd >= before ? "Up" : "Down"} ${Math.abs(Math.round(((m.usd - before) / before) * 100))}% On The Month Before` : undefined} />;
          })}
        </Stats>
      )}
      {people.length === 0 ? <Card title="Spend By Person, Last 30 Days"><Quiet>No AI Use In The Last 30 Days</Quiet></Card> : (
        <TopRows
          title="Spend By Person, Last 30 Days"
          items={people}
          keyOf={(p) => p.userId}
          row={(p, full) => (
            <>
              <Row
                lead={<IconCircle icon={User} />}
                title={p.email ?? p.userId.slice(0, 8)}
                meta={spend(p.total30)}
                detail={`Today ${spend(p.today)}, This Month ${spend(p.months.find((m) => m.month === thisMonth)?.usd ?? 0)}`}
                end={<Sparkline values={p.series} label={`Daily spend for ${p.email ?? "this person"} over 30 days`} />}
              />
              {full && (
                <div className="-mt-2 flex flex-col gap-1 pr-3 pb-3 pl-16 text-xs text-muted-foreground">
                  <span>{p.features.length > 0 ? p.features.map((f) => `${featureLabel(f.feature)} ${spend(f.usd)}`).join(", ") : "No Feature Spend"}</span>
                  {p.months.length > 0 && <span>{p.months.map((m) => `${monthName(m.month)} ${spend(m.usd)}`).join(", ")}</span>}
                </div>
              )}
            </>
          )}
        />
      )}
    </>
  );
}
