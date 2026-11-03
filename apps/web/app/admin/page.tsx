"use client";

// Admin, for the owner only (the database refuses every view's rows to anyone else): one page for running Konva, the old
// Admin and Analytics pages merged. Overview (alerts, AI billing and product health), Usage, AI (spend, quality and the
// budget), System (workers, queues, connectors, storage), Flags, Teams, Audit and Logos. The view, period and owner switch
// live in the address. The operator views stay mounted and hidden when not shown, so the budget form and the flags keep
// unsaved edits across views; the header Refresh asks every view to reload.

import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RefreshCw, ShieldCheck, UserX } from "lucide-react";
import { useAuth, useIsOwner } from "@/lib/auth";
import { buildAlerts, spendToday } from "@/lib/admin-ops";
import { cn } from "@/lib/utils";
import { PaneControls, PaneHeader, PaneSelect, ViewButtons } from "@/components/pane";
import { EmptyState } from "@/components/primitives";
import { PaneColumn } from "@/components/surface";
import { IconAction, Tip } from "@/components/tip";
import { Button } from "@/components/ui/button";
import { AiBudget } from "@/components/admin/ai-budget";
import { AiHistory } from "@/components/admin/ai-history";
import { AiUsage, BillingStats } from "@/components/admin/ai-usage";
import { Alerts } from "@/components/admin/alerts";
import { AuditLog } from "@/components/admin/audit-log";
import { FlagsPanel } from "@/components/admin/flags-panel";
import { clock } from "@/components/admin/format";
import { Logos } from "@/components/admin/logos";
import { Failed, LoadingCards } from "@/components/admin/parts";
import { Requests } from "@/components/admin/requests";
import { SystemHealth } from "@/components/admin/system-health";
import { useAdminOps } from "@/components/admin/use-admin-ops";
import { useAiUsage } from "@/components/admin/use-ai-usage";
import { RANGES, readAdminParams, type AdminView } from "@/components/admin/view-params";
import { OwnerInviteDialog, Workspaces, type OwnerInvite } from "@/components/admin/workspaces";
import { AiCards } from "@/components/analytics/ai-cards";
import { HealthCards } from "@/components/analytics/health-cards";
import { StorageFlags } from "@/components/analytics/storage-flags";
import { UsageCards } from "@/components/analytics/usage-cards";
import { useAnalytics } from "@/components/analytics/use-analytics";

const PERIODS = RANGES.map((d) => ({ value: String(d), label: `Last ${d} Days` }));
/** The views the owner switch changes: the product analytics ones. */
const ANALYTICS_VIEWS: AdminView[] = ["overview", "usage", "ai"];

function Admin() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { session } = useAuth();
  const isOwner = useIsOwner();
  const { view, days, exclude } = readAdminParams(params);
  const [tick, setTick] = useState(0);
  const [busyCount, setBusyCount] = useState(0);
  const [loadedAt, setLoadedAt] = useState(0);
  const [pending, setPending] = useState(0);
  const [query, setQuery] = useState("");
  const [ownerInvite, setOwnerInvite] = useState<OwnerInvite | null>(null);
  const [teamsVersion, setTeamsVersion] = useState(0);

  useEffect(() => {
    if (session && !isOwner) router.replace("/inbox");
  }, [session, isOwner, router]);

  // The view, the period and the switch live in the address, so a reload or a shared link comes back to the same place.
  const setParam = useCallback((key: "view" | "days" | "exclude", value: string | null) => {
    const next = new URLSearchParams(params.toString());
    next.delete("tab");
    if (value === null) next.delete(key);
    else next.set(key, value);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [params, pathname, router]);

  // Several views load at once, so busy is a count rather than a flag any one of them could clear.
  const onBusy = useCallback((busy: boolean) => setBusyCount((n) => Math.max(0, n + (busy ? 1 : -1))), []);
  const onTeamsChanged = useCallback(() => setTeamsVersion((v) => v + 1), []);
  useEffect(() => { if (busyCount === 0) setLoadedAt(Date.now()); }, [busyCount]);
  const ops = useAdminOps(tick, onBusy);
  const aiUsage = useAiUsage(tick, onBusy);
  const analytics = useAnalytics({ health: isOwner && view === "overview", summary: isOwner && (view === "usage" || view === "ai"), days, exclude });
  // The same live numbers System and AI show, so an alert can never disagree with them.
  const alerts = useMemo(
    () => buildAlerts({ health: ops.health, billingPausedSince: ops.billingPausedSince, unpricedModels: ops.unpricedModels, todayUsd: ops.history ? spendToday(ops.history.daily, new Date()) : null, dailyLimitUsd: ops.dailyLimitUsd }),
    [ops.health, ops.billingPausedSince, ops.unpricedModels, ops.history, ops.dailyLimitUsd],
  );

  if (!isOwner || analytics.denied) {
    return session ? (
      <div className="flex h-full min-h-0 flex-col">
        <EmptyState icon={ShieldCheck} title="Owner Only" description="Admin is only for the owner of this app." />
      </div>
    ) : null;
  }

  const current = view === "overview" ? analytics.health : analytics.usage;
  const isAnalytics = ANALYTICS_VIEWS.includes(view);
  const busy = busyCount > 0 || analytics.health.busy || analytics.usage.busy;
  const at = Math.max(loadedAt, isAnalytics ? current.at : 0);
  const refresh = () => {
    setTick((t) => t + 1);
    if (isAnalytics) current.refresh();
  };

  const items: { key: AdminView; label: string; count?: number }[] = [
    { key: "overview", label: "Overview", count: alerts.length },
    { key: "usage", label: "Usage" },
    { key: "ai", label: "AI", count: aiUsage.attention },
    { key: "system", label: "System" },
    { key: "flags", label: "Flags" },
    { key: "teams", label: "Teams", count: pending },
    { key: "audit", label: "Audit" },
    { key: "logos", label: "Logos" },
  ];
  const actions = (
    <>
      {isAnalytics && <IconAction label="Exclude Owner And Test Accounts" icon={UserX} active={exclude} onClick={() => setParam("exclude", exclude ? null : "1")} />}
      <Tip label={at ? `Updated ${clock(at)}` : "Refresh"}>
        <Button type="button" variant="ghost" size="icon" aria-label="Refresh" disabled={busy} onClick={refresh}><RefreshCw className={busy ? "animate-spin" : undefined} /></Button>
      </Tip>
    </>
  );
  const views = (
    <PaneControls>
      <ViewButtons label="Admin Views" value={view} onSelect={(v) => setParam("view", v === "overview" ? null : v)} items={items} />
      {(view === "usage" || view === "ai") && <PaneSelect label="Period" value={String(days)} onChange={(v) => setParam("days", v === "30" ? null : v)} options={PERIODS} className="w-36 shrink-0" />}
    </PaneControls>
  );

  // The product analytics for the open view: dimmed while a reload runs, the last good numbers kept when one fails.
  const analyticsBody = (body: ReactNode) => (
    !current.data ? (current.failed ? <Failed title="Could Not Load The Analytics" busy={current.busy} onRetry={current.refresh} /> : <LoadingCards />) : (
      <div className={cn("flex flex-col gap-3 transition-opacity", current.busy && "opacity-60")} aria-busy={current.busy}>
        {current.failed && <Failed title="Could Not Load The Analytics" busy={current.busy} onRetry={current.refresh} />}
        {body}
      </div>
    )
  );
  const shown = (v: AdminView) => cn("flex flex-col gap-3", view !== v && "hidden");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">
        <PaneHeader title="Admin" action={actions} views={views} search={view === "logos" ? { value: query, onChange: setQuery, placeholder: "Search Companies" } : undefined} />
      </div>
      <div className="min-h-0 flex-1">
        <PaneColumn width="5xl" grey>
          <div className={shown("overview")}>
            <BillingStats usage={aiUsage} />
            <Alerts alerts={alerts} loaded={ops.loaded} dailyLimitUsd={ops.dailyLimitUsd} onSaved={ops.reload} />
            {view === "overview" && analyticsBody(analytics.health.data && <HealthCards health={analytics.health.data} />)}
          </div>
          {view === "usage" && analyticsBody(analytics.reports && <UsageCards report={analytics.reports.usage} empty={analytics.reports.empty} />)}
          <div className={shown("ai")}>
            <AiUsage usage={aiUsage} />
            <AiHistory history={ops.history} failed={ops.failed.history} />
            {view === "ai" && analyticsBody(analytics.reports && <AiCards report={analytics.reports.ai} empty={analytics.reports.empty} />)}
            <AiBudget version={tick} onBusy={onBusy} />
          </div>
          <div className={shown("system")}>
            <SystemHealth health={ops.health} connectors={ops.connectors} failed={ops.failed} loaded={ops.loaded} />
            <StorageFlags version={tick} />
          </div>
          <div className={shown("flags")}><FlagsPanel version={tick} onBusy={onBusy} /></div>
          <div className={shown("teams")}>
            <Requests version={tick} onInvite={setOwnerInvite} onTeamsChanged={onTeamsChanged} onBusy={onBusy} onPending={setPending} />
            <Workspaces version={teamsVersion + tick} onInvite={setOwnerInvite} onBusy={onBusy} />
          </div>
          <div className={shown("audit")}><AuditLog version={tick} onBusy={onBusy} /></div>
          {view === "logos" && <Logos version={tick} query={query} onBusy={onBusy} />}
        </PaneColumn>
      </div>
      <OwnerInviteDialog invite={ownerInvite} onClose={() => setOwnerInvite(null)} />
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense>
      <Admin />
    </Suspense>
  );
}
