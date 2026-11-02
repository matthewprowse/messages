"use client";

// Admin, for the owner only: the database refuses every view's rows to anyone else. It opens on AI Usage (the Gemini billing
// state and who is flagged or paused, with spend history below), then AI Budget, Health (workers, queues, connectors),
// Alerts, Flags (kill switches), Teams (with access Requests on top), Updates, the changelog, and the Audit log. Every view stays mounted and is hidden when not shown, so the budget form keeps
// unsaved edits across tabs; the header Refresh asks each view to reload.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { useAuth, useIsOwner } from "@/lib/auth";
import { PaneControls, PaneHeader, ViewButtons } from "@/components/pane";
import { EmptyState } from "@/components/primitives";
import { AiBudget } from "@/components/admin/ai-budget";
import { AiUsage } from "@/components/admin/ai-usage";
import { AdminColumn } from "@/components/admin/parts";
import { AiHistory } from "@/components/admin/ai-history";
import { Alerts } from "@/components/admin/alerts";
import { AuditLog } from "@/components/admin/audit-log";
import { FlagsPanel } from "@/components/admin/flags-panel";
import { SystemHealth } from "@/components/admin/system-health";
import { useAdminOps } from "@/components/admin/use-admin-ops";
import { buildAlerts, spendToday } from "@/lib/admin-ops";
import { Requests } from "@/components/admin/requests";
import { OwnerInviteDialog, Workspaces, type OwnerInvite } from "@/components/admin/workspaces";
import { UpdatesPanel } from "@/components/updates/updates-panel";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

type View = "usage" | "budget" | "health" | "alerts" | "flags" | "teams" | "updates" | "audit";

const count = (label: string, n: number) => (n > 0 ? `${label} (${n})` : label);

export default function AdminPage() {
  const router = useRouter();
  const { session } = useAuth();
  const isOwner = useIsOwner();
  const [view, setView] = useState<View>("usage");
  const [tick, setTick] = useState(0);
  const [busyCount, setBusyCount] = useState(0);
  const [attention, setAttention] = useState(0);
  const [pending, setPending] = useState(0);
  const [ownerInvite, setOwnerInvite] = useState<OwnerInvite | null>(null);
  const [teamsVersion, setTeamsVersion] = useState(0);

  useEffect(() => {
    if (session && !isOwner) router.replace("/inbox");
  }, [session, isOwner, router]);

  // Several views load at once, so busy is a count rather than a flag any one of them could clear.
  const onBusy = useCallback((busy: boolean) => setBusyCount((n) => Math.max(0, n + (busy ? 1 : -1))), []);
  const onTeamsChanged = useCallback(() => setTeamsVersion((v) => v + 1), []);
  const ops = useAdminOps(tick, onBusy);
  // The same live numbers the Health and AI Usage sections show, so an alert can never disagree with them.
  const alerts = useMemo(
    () => buildAlerts({ health: ops.health, billingPausedSince: ops.billingPausedSince, unpricedModels: ops.unpricedModels, todayUsd: ops.history ? spendToday(ops.history.daily, new Date()) : null, dailyLimitUsd: ops.dailyLimitUsd }),
    [ops.health, ops.billingPausedSince, ops.unpricedModels, ops.history, ops.dailyLimitUsd],
  );

  if (!isOwner) {
    return session ? (
      <div className="flex h-full min-h-0 flex-col">
        <EmptyState icon={ShieldCheck} title="Owner Only" description="Admin is only for the owner of this app." />
      </div>
    ) : null;
  }

  const items: { key: View; label: string }[] = [
    { key: "usage", label: count("AI Usage", attention) },
    { key: "budget", label: "AI Budget" },
    { key: "health", label: "Health" },
    { key: "alerts", label: count("Alerts", alerts.length) },
    { key: "flags", label: "Flags" },
    { key: "teams", label: count("Teams", pending) },
    { key: "updates", label: "Updates" },
    { key: "audit", label: "Audit" },
  ];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">
        <PaneHeader title="Admin" action={<Button variant="ghost" size="icon" aria-label="Refresh" disabled={busyCount > 0} onClick={() => setTick((t) => t + 1)}><RefreshCw className={busyCount > 0 ? "animate-spin" : undefined} /></Button>}>
          <PaneControls>
            <ViewButtons label="Admin Sections" value={view} onSelect={setView} items={items} />
          </PaneControls>
        </PaneHeader>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <AdminColumn>
          <div hidden={view !== "usage"}>
            <AiUsage version={tick} onBusy={onBusy} onAttention={setAttention} />
            <AiHistory history={ops.history} failed={ops.failed.history} />
          </div>
          <div hidden={view !== "budget"}><AiBudget version={tick} onBusy={onBusy} /></div>
          <div hidden={view !== "health"}><SystemHealth health={ops.health} connectors={ops.connectors} failed={ops.failed} loaded={ops.loaded} /></div>
          <div hidden={view !== "alerts"}><Alerts alerts={alerts} loaded={ops.loaded} dailyLimitUsd={ops.dailyLimitUsd} onSaved={ops.reload} /></div>
          <div hidden={view !== "flags"}><FlagsPanel version={tick} onBusy={onBusy} /></div>
          <div className={view === "teams" ? "flex flex-col gap-6" : "hidden"}>
            <Requests version={tick} onInvite={setOwnerInvite} onTeamsChanged={onTeamsChanged} onBusy={onBusy} onPending={setPending} />
            <Workspaces version={teamsVersion + tick} onInvite={setOwnerInvite} onBusy={onBusy} />
          </div>
          <div hidden={view !== "updates"}><UpdatesPanel /></div>
          <div hidden={view !== "audit"}><AuditLog version={tick} onBusy={onBusy} /></div>
        </AdminColumn>
      </ScrollArea>
      <OwnerInviteDialog invite={ownerInvite} onClose={() => setOwnerInvite(null)} />
    </div>
  );
}
