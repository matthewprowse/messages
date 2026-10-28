"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useAuth, useIsOwner } from "@/lib/auth";
import { AnalyticsError, loadSummary, type Summary } from "@/lib/analytics-data";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AiTab } from "@/components/analytics/ai-tab";
import { UsageTab } from "@/components/analytics/usage-tab";
import { StorageFlags } from "@/components/analytics/storage-flags";
import { build } from "@/components/analytics/derive";
import { EmptyState, Loading } from "@/components/analytics/parts";

const RANGES = [7, 14, 30, 90] as const;
type Days = (typeof RANGES)[number];
const TABS = ["usage", "ai"] as const;
type TabName = (typeof TABS)[number];
const DEFAULT_DAYS: Days = 30;

interface Loaded {
  summary: Summary;
  /** The period this summary was loaded for. The numbers use it, so they stay true to the summary while a new period loads. */
  days: Days;
  at: number;
}

const clock = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

// Product analytics, for the owner only: the database refuses the summary to anyone else.
function Analytics() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { session } = useAuth();
  const isOwner = useIsOwner();
  const asked = Number(params.get("days"));
  const days: Days = (RANGES as readonly number[]).includes(asked) ? (asked as Days) : DEFAULT_DAYS;
  const tab: TabName = params.get("tab") === "ai" ? "ai" : "usage";
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    if (session && !isOwner) router.replace("/inbox");
  }, [session, isOwner, router]);

  // The period and the tab live in the address, so a reload or a shared link comes back to the same view.
  const setParam = useCallback(
    (key: "days" | "tab", value: string) => {
      const next = new URLSearchParams(params.toString());
      next.set(key, value);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  // One summary covers the period asked for and the one before it. A failure keeps what is already on screen.
  const refresh = useCallback(async (period: Days) => {
    const id = ++latest.current;
    setBusy(true);
    setFailed(false);
    try {
      const summary = await loadSummary(period);
      if (id !== latest.current) return;
      setData({ summary, days: period, at: Date.now() });
    } catch (e) {
      if (id !== latest.current) return;
      if (e instanceof AnalyticsError && e.kind === "denied") setDenied(true);
      else setFailed(true);
    } finally {
      if (id === latest.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (isOwner) void refresh(days);
  }, [isOwner, days, refresh]);

  const reports = useMemo(() => (data ? build(data.summary, data.days) : null), [data]);

  if (!isOwner || denied) {
    return session ? (
      <div className="w-full max-w-4xl p-3">
        <EmptyState title="Owner Only">Analytics is only for the owner of this app.</EmptyState>
      </div>
    ) : null;
  }
  const problem = failed && (
    <Alert variant="destructive">
      <AlertTitle>Could Not Load The Analytics</AlertTitle>
      <AlertDescription>{data ? "Showing the numbers from the last successful load. Check your connection and try again." : "Check your connection and try again."}</AlertDescription>
      <AlertAction>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh(days)}>Retry</Button>
      </AlertAction>
    </Alert>
  );

  return (
    <ScrollArea className="h-full">
      <div className="w-full max-w-4xl p-3">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="flex h-10 items-center text-lg font-medium">Analytics</h1>
            <p className="mt-1 text-sm text-muted-foreground">How the product is used and how well the AI works. Only counts, labels and times: no message text, names or addresses are ever recorded.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Select value={String(days)} onValueChange={(v) => setParam("days", v)}>
              <SelectTrigger className="w-36" aria-label="Period"><SelectValue /></SelectTrigger>
              <SelectContent>{RANGES.map((d) => <SelectItem key={d} value={String(d)}>Last {d} Days</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" asChild><Link href="/analytics/logos">Company Logos</Link></Button>
            {data && <span className="text-xs whitespace-nowrap text-muted-foreground">Updated {clock(data.at)}</span>}
            <Button variant="outline" size="icon" aria-label="Refresh" disabled={busy} onClick={() => void refresh(days)}><RefreshCw className={busy ? "animate-spin" : undefined} /></Button>
          </div>
        </div>
        {!reports || !data ? (
          failed ? problem : <Loading />
        ) : (
          <Tabs value={tab} onValueChange={(v) => setParam("tab", v)} className={busy ? "gap-6 opacity-60 transition-opacity" : "gap-6 transition-opacity"} aria-busy={busy}>
            <TabsList>
              <TabsTrigger value="usage">Usage</TabsTrigger>
              <TabsTrigger value="ai">AI</TabsTrigger>
            </TabsList>
            {problem}
            <TabsContent value="usage">
              <UsageTab report={reports.usage} empty={reports.empty} />
              <div className="mt-8"><StorageFlags /></div>
            </TabsContent>
            <TabsContent value="ai"><AiTab report={reports.ai} empty={reports.empty} /></TabsContent>
          </Tabs>
        )}
      </div>
    </ScrollArea>
  );
}

export default function AnalyticsPage() {
  return (
    <Suspense>
      <Analytics />
    </Suspense>
  );
}
