"use client";

// Admin's System view: whether the workers are alive (a lease per sync shard and one for the AI worker, each renewed every
// 30 seconds), how long the oldest row in each queue has waited, how each connector is doing (accounts by status, oldest
// good sync) and the error codes of the last 24 hours. Counts, ages and codes only. Rules and thresholds: lib/admin-ops.ts.

import { Bot, Inbox, Plug, Server, TriangleAlert } from "lucide-react";
import { AI_LEASE, ageText, errorTotals, leaseLevel, providerSummaries, queueLabel, queueLevel, splitLeases, type ConnectorHealth, type Health } from "@/lib/admin-ops";
import { providerLabel } from "@/components/primitives";
import { Card, IconCircle, Row, Separated } from "@/components/surface";
import { Badge } from "@/components/ui/badge";
import { Failed, LevelMark, LoadingCard, Quiet } from "./parts";

const labelOf = (p: string) => (providerLabel as Record<string, string>)[p] ?? p;

/** Worker leases, then queues. */
function Workers({ health }: { health: Health }) {
  const { shards, ai } = splitLeases(health.leases);
  const leaseRow = (name: string, label: string, lease: { expires_in_s: number } | null) => (
    <Row
      key={name}
      lead={<IconCircle icon={name === AI_LEASE ? Bot : Server} />}
      title={label}
      detail={lease ? (lease.expires_in_s > 0 ? `Lease Renewed, ${ageText(lease.expires_in_s)} Left` : `Lease Ran Out ${ageText(-lease.expires_in_s)} Ago`) : "No Lease. Stopped Or Not Started"}
      end={lease ? <LevelMark level={leaseLevel({ name, ...lease })} word={lease.expires_in_s > 0 ? undefined : "Expired"} /> : <LevelMark level="amber" word="No Lease" />}
    />
  );
  return (
    <>
      <Card title="Workers">
        <Separated>
          {shards.length === 0 ? leaseRow("shard-0", "Sync Worker", null) : shards.map((l) => leaseRow(l.name, `Sync Worker, ${l.name.replace("shard-", "Shard ")}`, l))}
          {leaseRow(AI_LEASE, "AI Worker", ai)}
        </Separated>
      </Card>
      <Card title="Queues">
        <Separated>
          {health.queues.map((q) => (
            <Row
              key={q.key}
              lead={<IconCircle icon={Inbox} />}
              title={queueLabel(q.key)}
              detail={q.depth === 0 ? "Nothing Waiting" : `${q.depth.toLocaleString()} Waiting, The Oldest For ${ageText(q.oldest_age_s)}`}
              end={<LevelMark level={queueLevel(q)} />}
            />
          ))}
        </Separated>
      </Card>
    </>
  );
}

/** Accounts by provider, then the error codes of the last day. */
function Connectors({ data }: { data: ConnectorHealth }) {
  const providers = providerSummaries(data.accounts);
  const codes = errorTotals(data.errors);
  return (
    <>
      <Card title="Connectors">
        {providers.length === 0 ? <Quiet>No Accounts Connected Yet</Quiet> : (
          <Separated>
            {providers.map((p) => (
              <Row
                key={p.provider}
                lead={<IconCircle icon={Plug} />}
                title={<>{labelOf(p.provider)}{p.error > 0 && <Badge variant="destructive" className="ml-2">{p.error} In Error</Badge>}</>}
                detail={`${p.total} ${p.total === 1 ? "Account" : "Accounts"}, ${p.connected} Connected${p.other > 0 ? `, ${p.other} Other` : ""}. Oldest Sync ${p.stalestS == null ? "None" : `${ageText(p.stalestS)} Ago`}`}
                end={<LevelMark level={p.level} word={p.level === "green" ? "OK" : p.level === "amber" ? "Behind" : "Failing"} />}
              />
            ))}
          </Separated>
        )}
      </Card>
      <Card title="Error Codes, Last 24 Hours">
        {codes.length === 0 ? <Quiet>No Errors Recorded</Quiet> : (
          <Separated>
            {codes.map((c) => (
              <Row
                key={`${c.provider}-${c.code}`}
                lead={<IconCircle icon={TriangleAlert} />}
                title={<span className="font-mono text-xs">{c.code}</span>}
                detail={c.provider ? labelOf(c.provider) : "Any Provider"}
                end={<span className="text-sm font-medium tabular-nums">{c.n.toLocaleString()}</span>}
              />
            ))}
          </Separated>
        )}
      </Card>
    </>
  );
}

/** Workers and queues, then connectors; each half fails on its own. */
export function SystemHealth({ health, connectors, failed, loaded }: { health: Health | null; connectors: ConnectorHealth | null; failed: { health: boolean; connectors: boolean }; loaded: boolean }) {
  if (!loaded) return <><LoadingCard title="Workers" /><LoadingCard title="Queues" /></>;
  return (
    <>
      {health ? <Workers health={health} /> : failed.health && <Failed title="Could Not Load System Health" />}
      {connectors ? <Connectors data={connectors} /> : failed.connectors && <Failed title="Could Not Load Connector Health" />}
    </>
  );
}
