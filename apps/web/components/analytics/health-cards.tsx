"use client";

// Admin's Overview, the product half: the founder's one screen. Weekly active people and stickiness, activation from signup,
// time to the first draft sent, weekly retention from signup, who has gone quiet, the value delivered per active person and
// the channel mix. It reads analytics_health, so none of it depends on the period picked for Usage and AI.

import { useState } from "react";
import type { Health } from "@/lib/analytics-health";
import { Card } from "@/components/surface";
import { PaneSelect } from "@/components/pane";
import { Bars } from "@/components/admin/bars";
import { SMALL_SAMPLE, money, nice, num, of, percent, seconds, share, shortDay } from "@/components/admin/format";
import { Quiet, Stat, Stats } from "@/components/admin/parts";
import { Table, type Col } from "@/components/admin/table";
import { channelRows, daysSince, funnelRows, retentionRows, stickinessPct, valueRows, type ActiveMode, type RetentionRow } from "./derive-health";

const FOLLOW_UP_WEEKS = 8;
const MODES: { value: ActiveMode; label: string }[] = [
  { value: "active", label: "Used The App" },
  { value: "valued", label: "Sent A Draft Or Reply" },
];
const VALUE_LABEL: Record<string, string> = { replies: "Replies Sent", drafts_sent: "Drafts Sent", triaged: "Conversations Sorted", junk_cleared: "Junk Cleared" };

const stepTime = (secs: number | null) => (secs === null ? "No Data" : secs === 0 ? "Start" : seconds(secs));

function Retention({ health }: { health: Health }) {
  const [mode, setMode] = useState<ActiveMode>("valued");
  const rows = retentionRows(health, mode);
  const cols: Col<RetentionRow>[] = [
    { head: "Signed Up In Week Of", cell: (g) => shortDay(g.start) },
    { head: "People", cell: (g) => num(g.size), num: true },
    ...Array.from({ length: FOLLOW_UP_WEEKS }, (_, k): Col<RetentionRow> => ({
      head: `Week ${k + 1}`,
      num: true,
      wide: k > 3,
      cell: (g) =>
        k < g.later.length ? (
          <span className={g.size < SMALL_SAMPLE ? "whitespace-nowrap text-muted-foreground" : "whitespace-nowrap"}>
            {of(g.later[k], g.size)} <span className="text-xs text-muted-foreground">{percent(Math.round(share(g.later[k], g.size)))}</span>
          </span>
        ) : (
          ""
        ),
    })),
  ];
  return (
    <Card title="Retention" action={<PaneSelect label="Count As Active" value={mode} onChange={(v) => setMode(v as ActiveMode)} options={MODES} className="w-48" />}>
      <Table cols={cols} rows={rows} empty="Nobody Signed Up In The Last 12 Weeks" />
    </Card>
  );
}

export function HealthCards({ health: h }: { health: Health }) {
  if (h.measured === 0 && h.funnel.cohort === 0) return <Card title="Product"><Quiet>Nobody To Measure Yet</Quiet></Card>;
  const sent = h.funnel.steps.find((s) => s.key === "first_draft_sent");
  const now = Date.now();
  return (
    <>
      <Stats>
        <Stat label="Active This Week" value={num(h.stickiness.wau)} note={`Of ${num(h.measured)} Measured`} />
        <Stat label="Active This Month" value={num(h.stickiness.mau)} note="Last 28 Days" />
        <Stat label="Stickiness" value={percent(stickinessPct(h))} note="Daily Over Monthly" />
        <Stat label="Came Back" value={num(h.stickiness.resurrected)} note="After 4 Quiet Weeks" />
      </Stats>
      <Bars label="Active People Each Week" data={h.weekly.map((w) => ({ label: shortDay(w.week), value: w.active }))} />

      <Card title="Activation, Last 90 Days">
        <Table
          rows={funnelRows(h)}
          cols={[
            { head: "Step", cell: (r) => nice(r.key) },
            { head: "People", cell: (r) => num(r.users), num: true },
            { head: "Of Signed Up", cell: (r) => percent(Math.round(r.pct)), num: true },
            { head: "Median Time", cell: (r) => stepTime(r.p50), num: true },
          ]}
        />
      </Card>

      <Stats>
        <Stat label="Median To First Draft Sent" value={sent?.p50_secs == null ? "No Data" : seconds(sent.p50_secs)} />
        <Stat label="Signups, Last 90 Days" value={num(h.funnel.cohort)} />
        {h.sharing_off > 0 && <Stat label="Sharing Off" value={num(h.sharing_off)} note="Not Counted" />}
      </Stats>
      <Card title="First Draft Sent By Signup Week">
        <Table
          empty="Nobody Has Signed Up Yet"
          rows={h.first_draft}
          cols={[
            { head: "Signed Up In Week Of", cell: (w) => shortDay(w.week) },
            { head: "People", cell: (w) => num(w.signups), num: true },
            { head: "Sent A Draft", cell: (w) => of(w.sent, w.signups), num: true },
            { head: "Median", cell: (w) => (w.p50_secs === null ? "No Data" : seconds(w.p50_secs)), num: true },
            { head: "Slowest 10%", cell: (w) => (w.p90_secs === null ? "No Data" : seconds(w.p90_secs)), num: true, wide: true },
          ]}
        />
      </Card>
      <Bars label="Signups Each Week" data={h.signups.map((w) => ({ label: shortDay(w.week), value: w.n }))} />

      <Retention health={h} />

      <Card title="Gone Quiet">
        <Table
          empty="Nobody Has Gone Quiet"
          rows={h.churn}
          cols={[
            { head: "Person", cell: (c) => <span className="font-mono text-xs">{c.user}</span> },
            { head: "Last Seen", cell: (c) => `${shortDay(c.last_seen)} (${num(daysSince(c.last_seen, now))} Days Ago)` },
            { head: "Signed Up", cell: (c) => shortDay(c.signed_up), wide: true },
            { head: "Accounts", cell: (c) => (c.account_error ? `${num(c.accounts)}, One In Error` : num(c.accounts)), num: true },
            { head: "Drafts Sent", cell: (c) => num(c.drafts_sent), num: true, wide: true },
            { head: "AI Cost", cell: (c) => money(c.ai_cost_micro / 1_000_000), num: true, wide: true },
          ]}
        />
      </Card>

      <Stats>
        {valueRows(h).map((v) => <Stat key={v.key} label={`${VALUE_LABEL[v.key]} Per Person`} value={num(v.now)} note={`Before ${num(v.before)}, ${num(v.total)} In All`} />)}
      </Stats>

      <Card title="Channel Mix">
        <Table
          empty="Nobody Has Connected An Account"
          rows={channelRows(h)}
          cols={[
            { head: "Connected", cell: (c) => (c.mix === "none" ? "Nothing Yet" : c.mix.split("+").map(nice).join(" And ")) },
            { head: "People", cell: (c) => num(c.users), num: true },
            { head: "Active This Week", cell: (c) => percent(c.activePct), num: true },
            { head: "Sent A Draft Or Reply", cell: (c) => num(c.valued28d), num: true, wide: true },
          ]}
        />
      </Card>
      <Card title="Days Active In The Last 28">
        <Table empty="Nobody Used The App In The Last 28 Days" rows={h.stickiness.curve} cols={[{ head: "Days", cell: (c) => num(c.days) }, { head: "People", cell: (c) => num(c.users), num: true }]} />
      </Card>
    </>
  );
}
