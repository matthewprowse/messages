"use client";

// The Usage tab of the Analytics page: reach, screens, features, dialogs, search, friction and reliability, from the
// UsageReport that derive.ts builds. Activation and retention live on the Health tab; the tables that need many people to
// mean anything (fields touched, repeated clicks, empty screens) sit under Advanced.

import type { UsageReport } from "./derive";
import { Advanced, Bars, CountTile, EmptyState, Note, Section, SECTIONS, Share, Table, Tile, Tiles, ms, nice, num, seconds, shortDay } from "./parts";

export function UsageTab({ report: r, empty }: { report: UsageReport; empty: boolean }) {
  if (empty) return <EmptyState title="Nothing Captured Yet">Events appear here as people use the app.</EmptyState>;
  return (
    <div className={SECTIONS}>
      <Section title="Reach" description="Everyone is a keyed hash, never a name or an address. A session ends after 30 minutes with nothing recorded.">
        <Tiles>
          <Tile label="Active Users" value={num(r.activeUsers.value)} stat={r.activeUsers} />
          <Tile label="Sessions" value={num(r.sessions.value)} stat={r.sessions} />
          <Tile label="App Opens" value={num(r.opens.value)} stat={r.opens} />
          <CountTile label="Came Back" part={r.cameBack.part} whole={r.cameBack.whole} note="Of last period's users" />
        </Tiles>
        <Bars label="Active Users Each Day" data={r.series.map((d) => ({ label: shortDay(d.day), value: d.users }))} />
        {r.dropped > 0 && <Note>{`${num(r.dropped)} events were over the rate limit and not recorded in this period, so counts are a little low.`}</Note>}
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

      <Section title="Features" description="What people choose to do. Choosing a non-default view or filter counts as a use. Users are real people, not the largest group.">
        <Table
          rows={r.features}
          cols={[
            { head: "Feature", cell: (f) => nice(f.feature) },
            { head: "Uses", cell: (f) => num(f.uses), num: true },
            { head: "Users", cell: (f) => num(f.users), num: true },
          ]}
        />
      </Section>

      <Section title="Dialogs" description="Opened, finished or abandoned.">
        <Table
          rows={r.dialogs}
          cols={[
            { head: "Dialog", cell: (d) => nice(d.dialog) },
            { head: "Opened", cell: (d) => num(d.opened), num: true },
            { head: "Submitted", cell: (d) => num(d.submitted), num: true },
            { head: "Abandoned", cell: (d) => <Share part={d.cancelled} whole={d.cancelled + d.submitted} />, num: true },
            { head: "Median Time", cell: (d) => seconds(d.medianSecs), num: true },
          ]}
        />
      </Section>

      <Section title="Search" description="Whether people find what they look for. Query length and result counts are not shown.">
        <Tiles>
          <Tile label="Searches" value={num(r.searches)} />
          <CountTile label="Picked A Result" part={r.picked.part} whole={r.picked.whole} />
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
            { head: "Slow (95th Percentile)", cell: (s) => ms(s.p95), num: true },
            { head: "Samples", cell: (s) => num(s.n), num: true, wide: true },
          ]}
        />
      </Section>

      <Section title="Reliability" description="From the sync worker. Sends are tried once and never retried, so there is no retry count.">
        <Tiles three>
          <CountTile label="Sends Failed" part={r.reliability.failed} whole={r.reliability.sent + r.reliability.failed} />
          <Tile label="WhatsApp Reconnects" value={num(r.reliability.reconnects)} />
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

      <Advanced>
        <Table
          empty="No dialogs closed yet."
          rows={r.dialogs}
          cols={[{ head: "Dialog", cell: (d) => nice(d.dialog) }, { head: "Fields Touched Most", cell: (d) => (d.fields.length ? d.fields.slice(0, 3).map((f) => nice(f.key)).join(", ") : "None") }]}
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
      </Advanced>
    </div>
  );
}
