"use client";

// Admin's Usage view: reach, screens, features, dialogs, search, friction and reliability over the period picked in the
// header, from the UsageReport that derive.ts builds. The tables that need many people to mean anything (fields touched,
// repeated clicks, empty screens) sit under Advanced. Counts, labels and times only.

import { Card } from "@/components/surface";
import { Bars } from "@/components/admin/bars";
import { change, ms, nice, num, seconds, shortDay } from "@/components/admin/format";
import { Advanced, CountStat, Quiet, Stat, Stats } from "@/components/admin/parts";
import { Share, Table } from "@/components/admin/table";
import type { UsageReport } from "./derive";

export function UsageCards({ report: r, empty }: { report: UsageReport; empty: boolean }) {
  if (empty) return <Card title="Usage"><Quiet>Nothing Captured Yet</Quiet></Card>;
  return (
    <>
      <Stats>
        <Stat label="Active Users" value={num(r.activeUsers.value)} note={change(r.activeUsers)} />
        <Stat label="Sessions" value={num(r.sessions.value)} note={change(r.sessions)} />
        <Stat label="App Opens" value={num(r.opens.value)} note={change(r.opens)} />
        <CountStat label="Came Back" part={r.cameBack.part} whole={r.cameBack.whole} />
      </Stats>
      <Bars label="Active Users Each Day" data={r.series.map((d) => ({ label: shortDay(d.day), value: d.users }))} />
      {r.dropped > 0 && <Card title="Over The Rate Limit"><Quiet>{`${num(r.dropped)} events were not recorded, so counts are a little low.`}</Quiet></Card>}

      <Card title="Screens">
        <Table
          rows={r.screens}
          cols={[
            { head: "Screen", cell: (s) => nice(s.screen) },
            { head: "Views", cell: (s) => num(s.views), num: true },
            { head: "Users", cell: (s) => num(s.users), num: true },
            { head: "Median Time", cell: (s) => seconds(s.medianSecs), num: true },
          ]}
        />
      </Card>

      <Card title="Features">
        <Table
          rows={r.features}
          cols={[
            { head: "Feature", cell: (f) => nice(f.feature) },
            { head: "Uses", cell: (f) => num(f.uses), num: true },
            { head: "Users", cell: (f) => num(f.users), num: true },
          ]}
        />
      </Card>

      <Card title="Dialogs">
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
      </Card>

      <Stats>
        <Stat label="Searches" value={num(r.searches)} />
        <CountStat label="Picked A Result" part={r.picked.part} whole={r.picked.whole} />
        <CountStat label="Sends Failed" part={r.reliability.failed} whole={r.reliability.sent + r.reliability.failed} />
        <Stat label="WhatsApp Reconnects" value={num(r.reliability.reconnects)} />
      </Stats>

      <Card title="Errors">
        <Table
          empty="No Errors"
          rows={r.errors}
          cols={[
            { head: "Error", cell: (e) => nice(e.code) },
            { head: "Screen", cell: (e) => nice(e.where) },
            { head: "Times", cell: (e) => num(e.n), num: true },
            { head: "Users", cell: (e) => num(e.users), num: true },
          ]}
        />
      </Card>
      <Card title="Slowest Loads">
        <Table
          empty="No Load Times Yet"
          rows={r.slow}
          cols={[
            { head: "Load", cell: (s) => nice(s.what) },
            { head: "Typical", cell: (s) => ms(s.p50), num: true, wide: true },
            { head: "Slow (95th Percentile)", cell: (s) => ms(s.p95), num: true },
            { head: "Samples", cell: (s) => num(s.n), num: true, wide: true },
          ]}
        />
      </Card>
      <Card title="Sync Errors" action={<span className="text-sm tabular-nums">{num(r.reliability.syncErrors.reduce((s, e) => s + e.n, 0))}</span>}>
        <Table
          empty="No Sync Errors"
          rows={r.reliability.syncErrors}
          cols={[
            { head: "Provider", cell: (e) => nice(e.provider) },
            { head: "Code", cell: (e) => nice(e.code) },
            { head: "Times", cell: (e) => num(e.n), num: true },
          ]}
        />
      </Card>

      <Advanced>
        <Card title="Fields Touched Most">
          <Table
            empty="No Dialogs Closed Yet"
            rows={r.dialogs}
            cols={[{ head: "Dialog", cell: (d) => nice(d.dialog) }, { head: "Fields", cell: (d) => (d.fields.length ? d.fields.slice(0, 3).map((f) => nice(f.key)).join(", ") : "None") }]}
          />
        </Card>
        <Card title="Clicked Again And Again">
          <Table empty="No Repeated Clicking" rows={r.rage} cols={[{ head: "What", cell: (c) => nice(c.key) }, { head: "Times", cell: (c) => num(c.n), num: true }]} />
        </Card>
        <Card title="Empty Or Failed Screens">
          <Table empty="None Reached" rows={r.empty} cols={[{ head: "Screen", cell: (c) => nice(c.key) }, { head: "Times", cell: (c) => num(c.n), num: true }]} />
        </Card>
      </Advanced>
    </>
  );
}
