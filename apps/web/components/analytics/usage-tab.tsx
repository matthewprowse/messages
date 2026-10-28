"use client";

// The Usage tab of the Analytics page: activation, retention, and where people spend time, from the UsageReport that derive.ts builds.

import type { Retention, UsageReport } from "./derive";
import { Bars, CountTile, EmptyState, Section, SECTIONS, Share, Table, Tile, Tiles, type Col, ms, nice, num, of, percent, seconds, share, shortDay } from "./parts";

const FOLLOW_UP_WEEKS = 4;

function Activation({ c }: { c: UsageReport["activation"] }) {
  return (
    <Section title="Activation" description="Of the people active in this period, how many got set up and used the main feature. An account connected before the events began is not seen.">
      <Tiles three>
        <Tile label="Signed In" value={num(c.active)} note="Active in this period" />
        <CountTile label="Connected An Account" part={c.connected} whole={c.active} />
        <CountTile label="Sent A Draft" part={c.sentDraft} whole={c.active} />
      </Tiles>
    </Section>
  );
}

function RetentionTable({ groups }: { groups: Retention[] }) {
  const cols: Col<Retention>[] = [
    { head: "First Seen In Week Of", cell: (g) => shortDay(g.start) },
    { head: "People", cell: (g) => num(g.size), num: true },
    ...Array.from({ length: FOLLOW_UP_WEEKS }, (_, k): Col<Retention> => ({
      head: `Week ${k + 1}`,
      num: true,
      cell: (g) =>
        k < g.later.length ? (
          <span className="whitespace-nowrap">
            {of(g.later[k], g.size)} <span className="text-xs text-muted-foreground">{percent(Math.round(share(g.later[k], g.size)))}</span>
          </span>
        ) : (
          ""
        ),
    })),
  ];
  return <Table cols={cols} rows={groups} empty="Not enough history yet. Pick a longer period to see people come back week by week." />;
}

export function UsageTab({ report: r, empty }: { report: UsageReport; empty: boolean }) {
  if (empty) return <EmptyState title="Nothing Captured Yet">Events appear here as people use the app.</EmptyState>;
  return (
    <div className={SECTIONS}>
      <Activation c={r.activation} />

      <Section title="Retention" description="Groups of people by the week they were first seen, and how many were seen again in each week after.">
        <RetentionTable groups={r.retention} />
      </Section>

      <Section title="Reach" description="Everyone is a keyed hash, never a name or an address.">
        <Tiles>
          <Tile label="Active Users" value={num(r.activeUsers.value)} stat={r.activeUsers} />
          <Tile label="Sessions" value={num(r.sessions.value)} stat={r.sessions} />
          <Tile label="App Opens" value={num(r.opens.value)} stat={r.opens} />
          <CountTile label="Came Back" part={r.cameBack.part} whole={r.cameBack.whole} note="Of last period's users" />
        </Tiles>
        <Bars label="Active Users Each Day" data={r.series.map((d) => ({ label: shortDay(d.day), value: d.users }))} />
        {r.sizes.length > 0 && (
          <Table cols={[{ head: "Device", cell: (s) => nice(s.key) }, { head: "Users", cell: (s) => num(s.n), num: true }]} rows={r.sizes} />
        )}
      </Section>

      <Section title="Screens" description="Views, people, and the usual time on screen while the tab was showing.">
        <Table
          rows={r.screens}
          cols={[
            { head: "Screen", cell: (s) => nice(s.screen) },
            { head: "Views", cell: (s) => num(s.views), num: true },
            { head: "Users", cell: (s) => num(s.users), num: true },
            { head: "Median Time", cell: (s) => seconds(s.medianSecs), num: true },
          ]}
        />
      </Section>

      <Section title="Features" description="What people choose to do. Choosing a non-default view or filter counts as a use.">
        <Table
          rows={r.features}
          cols={[
            { head: "Feature", cell: (f) => nice(f.feature) },
            { head: "Uses", cell: (f) => num(f.uses), num: true },
            { head: "Users", cell: (f) => num(f.users), num: true },
          ]}
        />
        <Table
          empty="No settings changed."
          rows={r.settings}
          cols={[{ head: "Setting Changed", cell: (s) => nice(s.key) }, { head: "Times", cell: (s) => num(s.n), num: true }]}
        />
      </Section>

      <Section title="Dialogs" description="Opened, finished or abandoned. The fields are the ones people touched before leaving.">
        <Table
          rows={r.dialogs}
          cols={[
            { head: "Dialog", cell: (d) => nice(d.dialog) },
            { head: "Opened", cell: (d) => num(d.opened), num: true },
            { head: "Submitted", cell: (d) => num(d.submitted), num: true },
            { head: "Abandoned", cell: (d) => <Share part={d.cancelled} whole={d.cancelled + d.submitted} />, num: true },
            { head: "Median Time", cell: (d) => seconds(d.medianSecs), num: true },
            { head: "Touched Most", cell: (d) => (d.fields.length ? d.fields.slice(0, 3).map((f) => nice(f.key)).join(", ") : "None") },
          ]}
        />
      </Section>

      <Section title="Search">
        <Tiles>
          <Tile label="Searches" value={num(r.search.count)} />
          <CountTile label="Picked A Result" part={r.picked.part} whole={r.picked.whole} note={r.search.avgRank ? `usually result ${num(r.search.avgRank)}` : undefined} />
          <Tile label="Results Shown" value={num(r.search.avgResults)} note="On average" />
          <Tile label="Query Length" value={num(r.search.avgLen)} note="Characters, on average" />
        </Tiles>
      </Section>

      <Section title="Friction" description="Where the app let people down.">
        <Table
          empty="No errors."
          rows={r.errors}
          cols={[
            { head: "Error", cell: (e) => nice(e.code) },
            { head: "Screen", cell: (e) => nice(e.where) },
            { head: "Times", cell: (e) => num(e.n), num: true },
            { head: "Users", cell: (e) => num(e.users), num: true },
          ]}
        />
        <Table
          empty="No load times yet."
          rows={r.slow}
          cols={[
            { head: "Slowest Loads", cell: (s) => nice(s.what) },
            { head: "Typical", cell: (s) => ms(s.p50), num: true, wide: true },
            { head: "Slow (95th)", cell: (s) => ms(s.p95), num: true },
            { head: "Samples", cell: (s) => num(s.n), num: true, wide: true },
          ]}
        />
        <Table
          empty="No repeated clicking."
          rows={r.rage}
          cols={[{ head: "Clicked Again And Again", cell: (c) => nice(c.key) }, { head: "Times", cell: (c) => num(c.n), num: true }]}
        />
        <Table
          empty="No empty or failed screens reached."
          rows={r.empty}
          cols={[{ head: "Empty Or Failed Screens", cell: (c) => nice(c.key) }, { head: "Times", cell: (c) => num(c.n), num: true }]}
        />
      </Section>

      <Section title="Reliability" description="From the sync worker.">
        <Tiles>
          <CountTile label="Sends Failed" part={r.reliability.failed} whole={r.reliability.sent + r.reliability.failed} />
          <Tile label="WhatsApp Reconnects" value={num(r.reliability.reconnects)} />
          <Tile label="Send Retries" value={num(r.reliability.retries)} />
          <Tile label="Sync Errors" value={num(r.reliability.syncErrors.reduce((s, e) => s + e.n, 0))} />
        </Tiles>
        <Table
          empty="No sync errors."
          rows={r.reliability.syncErrors}
          cols={[
            { head: "Provider", cell: (e) => nice(e.provider) },
            { head: "Code", cell: (e) => nice(e.code) },
            { head: "Times", cell: (e) => num(e.n), num: true },
          ]}
        />
      </Section>
    </div>
  );
}
