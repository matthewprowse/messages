"use client";

// The Health tab of the Analytics page: the founder's one screen. Activation from signup, time to the first draft sent,
// weekly retention from signup, weekly active people and stickiness, who has gone quiet, the value delivered per active
// person and the channel mix. It reads analytics_health, so none of it depends on the period picked for the other tabs.

import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Health } from "@/lib/analytics-health";
import { channelRows, daysSince, funnelRows, retentionRows, stickinessPct, valueRows, type ActiveMode, type RetentionRow } from "./derive-health";
import { Bars, EmptyState, Note, Section, SECTIONS, SMALL_SAMPLE, Table, Tile, Tiles, money, nice, num, of, percent, seconds, share, shortDay, type Col } from "./parts";

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
    <div className="space-y-3">
      <Select value={mode} onValueChange={(v) => setMode(v as ActiveMode)}>
        <SelectTrigger size="sm" className="w-56" aria-label="Count as active"><SelectValue /></SelectTrigger>
        <SelectContent>{MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
      </Select>
      <Table cols={cols} rows={rows} empty="Nobody has signed up in the last 12 weeks." />
    </div>
  );
}

export function HealthTab({ health: h }: { health: Health }) {
  if (h.measured === 0 && h.funnel.cohort === 0) return <EmptyState title="Nobody To Measure Yet">People appear here once they sign up and use the app.</EmptyState>;
  const funnel = funnelRows(h);
  const sent = h.funnel.steps.find((s) => s.key === "first_draft_sent");
  const value = valueRows(h);
  const channels = channelRows(h);
  const now = Date.now();
  return (
    <div className={SECTIONS}>
      <Section title="Right Now" description={`Out of ${num(h.measured)} people measured${h.sharing_off ? `. ${num(h.sharing_off)} turned usage sharing off and are not counted` : ""}. Active means they used the app.`}>
        <Tiles>
          <Tile label="Active This Week" value={num(h.stickiness.wau)} note="Last 7 days" />
          <Tile label="Active This Month" value={num(h.stickiness.mau)} note="Last 28 days" />
          <Tile label="Stickiness" value={percent(stickinessPct(h))} note="Daily over monthly active people" />
          <Tile label="Came Back After A Break" value={num(h.stickiness.resurrected)} note="Active this week after 4 quiet weeks" />
        </Tiles>
        <Bars label="Active People Each Week" data={h.weekly.map((w) => ({ label: shortDay(w.week), value: w.active }))} />
      </Section>

      <Section title="Activation" description="People who signed up in the last 90 days, and how many got each step done at any time. Time is the median from signup.">
        <Table
          rows={funnel}
          cols={[
            { head: "Step", cell: (r) => nice(r.key) },
            { head: "People", cell: (r) => num(r.users), num: true },
            { head: "Of Signed Up", cell: (r) => percent(Math.round(r.pct)), num: true },
            { head: "Median Time", cell: (r) => stepTime(r.p50), num: true },
          ]}
        />
      </Section>

      <Section title="Time To First Draft Sent" description="The clearest sign the product works for someone. By the week they signed up.">
        <Tiles>
          <Tile label="Median" value={sent?.p50_secs == null ? "No Data" : seconds(sent.p50_secs)} note="From signup, in the last 90 days" />
          <Tile label="Signups" value={num(h.funnel.cohort)} note="In the last 90 days" />
        </Tiles>
        <Table
          empty="Nobody has signed up yet."
          rows={h.first_draft}
          cols={[
            { head: "Signed Up In Week Of", cell: (w) => shortDay(w.week) },
            { head: "People", cell: (w) => num(w.signups), num: true },
            { head: "Sent A Draft", cell: (w) => of(w.sent, w.signups), num: true },
            { head: "Median", cell: (w) => (w.p50_secs === null ? "No Data" : seconds(w.p50_secs)), num: true },
            { head: "Slowest 10%", cell: (w) => (w.p90_secs === null ? "No Data" : seconds(w.p90_secs)), num: true, wide: true },
          ]}
        />
        <Bars label="Signups Each Week" data={h.signups.map((w) => ({ label: shortDay(w.week), value: w.n }))} />
      </Section>

      <Section title="Retention" description="Groups of people by the week they signed up, and how many were still around each week after. Weeks run Monday to Sunday, UTC.">
        <Retention health={h} />
      </Section>

      <Section title="Gone Quiet" description="Active the week before last and not since, newest first. Look at the ones with an account in error first.">
        <Table
          empty="Nobody has gone quiet."
          rows={h.churn}
          cols={[
            { head: "Person", cell: (c) => <span className="font-mono text-xs">{c.user}</span> },
            { head: "Last Seen", cell: (c) => `${shortDay(c.last_seen)} (${num(daysSince(c.last_seen, now))} days ago)` },
            { head: "Signed Up", cell: (c) => shortDay(c.signed_up), wide: true },
            { head: "Accounts", cell: (c) => (c.account_error ? `${num(c.accounts)}, one in error` : num(c.accounts)), num: true },
            { head: "Drafts Sent", cell: (c) => num(c.drafts_sent), num: true, wide: true },
            { head: "AI Cost", cell: (c) => money(c.ai_cost_micro / 1_000_000), num: true, wide: true },
          ]}
        />
      </Section>

      <Section title="Value Delivered" description="What the product did, per active person, over the last 7 days against the 7 before.">
        <Tiles>
          {value.map((v) => (
            <Tile key={v.key} label={VALUE_LABEL[v.key]} value={num(v.now)} note={`Per person, ${num(v.total)} in all. Before: ${num(v.before)}`} />
          ))}
        </Tiles>
      </Section>

      <Section title="Channel Mix" description="What people have connected. Which mix keeps people is the question.">
        <Table
          empty="Nobody has connected an account."
          rows={channels}
          cols={[
            { head: "Connected", cell: (c) => (c.mix === "none" ? "Nothing Yet" : c.mix.split("+").map(nice).join(" And ")) },
            { head: "People", cell: (c) => num(c.users), num: true },
            { head: "Active This Week", cell: (c) => percent(c.activePct), num: true },
            { head: "Sent A Draft Or Reply", cell: (c) => num(c.valued28d), num: true, wide: true },
          ]}
        />
        {h.stickiness.curve.length > 0 && (
          <Table
            rows={h.stickiness.curve}
            cols={[{ head: "Days Active In The Last 28", cell: (c) => num(c.days) }, { head: "People", cell: (c) => num(c.users), num: true }]}
          />
        )}
        {h.stickiness.curve.length === 0 && <Note>Nobody has used the app in the last 28 days.</Note>}
      </Section>
    </div>
  );
}
