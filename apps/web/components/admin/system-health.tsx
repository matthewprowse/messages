"use client";

// Admin, Health: whether the workers are alive (a lease per sync shard and one for the AI worker), how long the oldest row in
// each queue has waited, and how each connector is doing (accounts by status, last good sync, error codes over 24 hours).
// Counts, ages and codes only: nothing about anyone's mail, names or addresses. Rules and thresholds: lib/admin-ops.ts.

import { Activity, Plug } from "lucide-react";
import { AI_LEASE, ageText, errorTotals, leaseLevel, providerSummaries, queueLabel, queueLevel, splitLeases, type ConnectorHealth, type Health } from "@/lib/admin-ops";
import { EmptyState, providerLabel } from "@/components/primitives";
import { AdminHeading, AdminRow } from "@/components/admin/parts";
import { LevelMark } from "@/components/admin/ops-parts";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

const labelOf = (p: string) => (providerLabel as Record<string, string>)[p] ?? p;

/** Worker leases and queues. */
function Workers({ health }: { health: Health }) {
  const { shards, ai } = splitLeases(health.leases);
  const leaseRow = (name: string, label: string, lease: { expires_in_s: number } | null) => (
    <AdminRow key={name} title={label} description={lease ? (lease.expires_in_s > 0 ? `Lease renewed, ${ageText(lease.expires_in_s)} left` : `Lease ran out ${ageText(-lease.expires_in_s)} ago`) : "Holds no lease. Stopped, or not yet started."}>
      {lease ? <LevelMark level={leaseLevel({ name, ...lease })} word={lease.expires_in_s > 0 ? undefined : "Expired"} /> : <LevelMark level="amber" word="No Lease" />}
    </AdminRow>
  );
  return (
    <>
      <AdminHeading title="Workers" description="Each worker renews a lease every 30 seconds. A lease that runs out means that worker has stopped." />
      <div>
        {shards.length === 0 ? leaseRow("shard-0", "Sync Worker", null) : shards.map((l) => leaseRow(l.name, `Sync Worker, ${l.name.replace("shard-", "Shard ")}`, l))}
        <Separator className="ml-3" />
        {leaseRow(AI_LEASE, "AI Worker", ai)}
      </div>
      <AdminHeading title="Queues" description="How many rows are waiting and how long the oldest has waited. Amber and red mean it is slower than usual or stuck." />
      <div>
        {health.queues.map((q, i) => (
          <div key={q.key}>
            {i > 0 && <Separator className="ml-3" />}
            <AdminRow title={queueLabel(q.key)} description={q.depth === 0 ? "Nothing waiting" : `${q.depth.toLocaleString()} waiting, the oldest for ${ageText(q.oldest_age_s)}`}>
              <LevelMark level={queueLevel(q)} />
            </AdminRow>
          </div>
        ))}
      </div>
    </>
  );
}

/** Accounts by provider and the error codes of the last day. */
function Connectors({ data }: { data: ConnectorHealth }) {
  const providers = providerSummaries(data.accounts);
  const codes = errorTotals(data.errors);
  return (
    <>
      <AdminHeading title="Connectors" description="Accounts by provider. The sync age is the oldest good sync among connected accounts." />
      {providers.length === 0 ? (
        <div className="py-8"><EmptyState icon={Plug} title="No Accounts" description="No accounts are connected yet." /></div>
      ) : (
        <div>
          {providers.map((p, i) => (
            <div key={p.provider}>
              {i > 0 && <Separator className="ml-3" />}
              <AdminRow
                title={<>{labelOf(p.provider)}{p.error > 0 && <Badge variant="destructive">{p.error} in Error</Badge>}</>}
                description={`${p.total} ${p.total === 1 ? "account" : "accounts"}, ${p.connected} connected${p.other > 0 ? `, ${p.other} other` : ""}. Oldest sync ${p.stalestS == null ? "None" : `${ageText(p.stalestS)} ago`}`}
              >
                <LevelMark level={p.level} word={p.level === "green" ? "OK" : p.level === "amber" ? "Behind" : "Failing"} />
              </AdminRow>
            </div>
          ))}
        </div>
      )}
      <AdminHeading title="Error Codes, Last 24 Hours" description="Codes only, never addresses. Counts come from people who share usage data, so the real number is at least this high." />
      {codes.length === 0 ? (
        <p className="px-3 text-sm text-muted-foreground">No errors recorded.</p>
      ) : (
        <div>
          {codes.map((c, i) => (
            <div key={`${c.provider}-${c.code}`}>
              {i > 0 && <Separator className="ml-3" />}
              <AdminRow title={<span className="font-mono text-xs">{c.code}</span>} description={c.provider ? labelOf(c.provider) : "Any provider"}>
                <span className="text-sm font-medium tabular-nums">{c.n.toLocaleString()}</span>
              </AdminRow>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** The Health section: workers and queues, then connectors. */
export function SystemHealth({ health, connectors, failed, loaded }: { health: Health | null; connectors: ConnectorHealth | null; failed: { health: boolean; connectors: boolean }; loaded: boolean }) {
  if (!loaded) return <div className="flex flex-col gap-3"><Skeleton className="h-16 w-full rounded-lg" /><Skeleton className="h-16 w-full rounded-lg" /></div>;
  return (
    <div className="flex flex-col gap-3">
      {health ? <Workers health={health} /> : failed.health && <EmptyState icon={Activity} title="Could Not Load System Health" description="Check your connection and refresh. If it keeps failing, the operator migrations may not be applied." />}
      {connectors ? <Connectors data={connectors} /> : failed.connectors && <EmptyState icon={Plug} title="Could Not Load Connector Health" description="Check your connection and refresh." />}
    </div>
  );
}
