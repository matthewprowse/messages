"use client";

// Product analytics, for the owner only: the database refuses the numbers to anyone else. Three tabs: Health (the
// founder's one screen), Usage and AI. Each tab loads only its own numbers, when it is open.

import { Suspense, useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useAuth, useIsOwner } from "@/lib/auth";
import { loadSummary, type Summary } from "@/lib/analytics-data";
import { loadHealth } from "@/lib/analytics-health";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { PaneControls, PaneHeader, PaneSelect, ViewButtons } from "@/components/pane";
import { AiTab } from "@/components/analytics/ai-tab";
import { HealthTab } from "@/components/analytics/health-tab";
import { UsageTab } from "@/components/analytics/usage-tab";
import { StorageFlags } from "@/components/analytics/storage-flags";
import { useLoaded } from "@/components/analytics/use-loaded";
import { build } from "@/components/analytics/derive";
import { EmptyState, Loading } from "@/components/analytics/parts";

const RANGES = [7, 14, 30, 90] as const;
type Days = (typeof RANGES)[number];
const TABS = ["health", "usage", "ai"] as const;
type TabName = (typeof TABS)[number];
const DEFAULT_DAYS: Days = 30;

const stamp = (t: number) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Analytics() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { session } = useAuth();
  const isOwner = useIsOwner();
  const asked = Number(params.get("days"));
  const days: Days = (RANGES as readonly number[]).includes(asked) ? (asked as Days) : DEFAULT_DAYS;
  const tabParam = params.get("tab");
  const tab: TabName = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as TabName) : "health";
  const exclude = params.get("exclude") === "1";

  useEffect(() => {
    if (session && !isOwner) router.replace("/inbox");
  }, [session, isOwner, router]);

  // The tab, the period and the switch live in the address, so a reload or a shared link comes back to the same view.
  const setParam = useCallback(
    (key: "days" | "tab" | "exclude", value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value === null) next.delete(key);
      else next.set(key, value);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  // One summary covers the period asked for and the one before it. Health is worked out from signup, not from the period.
  const loadUsage = useCallback(async () => ({ summary: await loadSummary(days, exclude), days }), [days, exclude]);
  const loadHealthNow = useCallback(() => loadHealth(exclude), [exclude]);
  const usage = useLoaded(loadUsage, isOwner && tab !== "health");
  const health = useLoaded(loadHealthNow, isOwner && tab === "health");

  const reports = useMemo(() => (usage.data ? build(usage.data.summary as Summary, usage.data.days) : null), [usage.data]);
  const current = tab === "health" ? health : usage;

  if (!isOwner || usage.denied || health.denied) {
    return session ? (
      <div className="mx-auto w-full max-w-4xl p-3">
        <EmptyState title="Owner Only">Analytics is only for the owner of this app.</EmptyState>
      </div>
    ) : null;
  }
  const problem = current.failed && (
    <Alert variant="destructive">
      <AlertTitle>Could Not Load The Analytics</AlertTitle>
      <AlertDescription>{current.data ? "Showing the numbers from the last successful load. Check your connection and try again." : "Check your connection and try again."}</AlertDescription>
      <AlertAction>
        <Button size="sm" variant="secondary" disabled={current.busy} onClick={current.refresh}>Retry</Button>
      </AlertAction>
    </Alert>
  );

  const views: { key: TabName; label: string }[] = [{ key: "health", label: "Health" }, { key: "usage", label: "Usage" }, { key: "ai", label: "AI" }];
  const periods = RANGES.map((d) => ({ value: String(d), label: `Last ${d} Days` }));
  const body = (() => {
    if (tab === "health") return health.data ? <HealthTab health={health.data} /> : null;
    if (!reports) return null;
    return tab === "usage" ? (
      <>
        <UsageTab report={reports.usage} empty={reports.empty} />
        <div className="border-t pt-3"><StorageFlags /></div>
      </>
    ) : (
      <AiTab report={reports.ai} empty={reports.empty} />
    );
  })();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">
        <PaneHeader
          title="Analytics"
          action={<Button variant="ghost" size="icon" aria-label="Refresh" disabled={current.busy} onClick={current.refresh}><RefreshCw className={current.busy ? "animate-spin" : undefined} /></Button>}
        >
          <PaneControls>
            <ViewButtons label="Show" value={tab} onSelect={(v) => setParam("tab", v)} items={views} />
            {tab !== "health" && <PaneSelect label="Period" value={String(days)} onChange={(v) => setParam("days", v)} options={periods} />}
          </PaneControls>
        </PaneHeader>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 p-3 md:px-4">
          <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="min-w-0 text-xs text-muted-foreground">
              Counts, labels and times only. Never message text.{current.data ? ` Updated ${stamp(current.at)}.` : ""}
            </p>
            <div className="flex items-center gap-2">
              <Switch id="analytics-exclude" checked={exclude} onCheckedChange={(on) => setParam("exclude", on ? "1" : null)} />
              <Label htmlFor="analytics-exclude" className="text-xs font-normal">Exclude Owner And Test Accounts</Label>
            </div>
          </div>
          {!current.data ? (
            current.failed ? problem : <Loading />
          ) : (
            <div className={current.busy ? "flex flex-col gap-3 opacity-60 transition-opacity" : "flex flex-col gap-3 transition-opacity"} aria-busy={current.busy}>
              {problem}
              {body}
            </div>
          )}
          <div className="border-t pt-3">
            <Button variant="link" className="h-auto p-0 text-xs" asChild><Link href="/analytics/logos">Company Logos</Link></Button>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <Suspense>
      <Analytics />
    </Suspense>
  );
}
