"use client";

// Settings, Usage: how much of the AI allowance is used, per feature, read from the my_ai_allowance function, then storage.
// The allowance comes first as it is the limit people run into; storage rarely changes.

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsBody, SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";
import { SettingsPage } from "@/components/settings/settings-page";
import { IconAction } from "@/components/tip";
import { StorageSection } from "@/components/settings/storage-section";
import { FEATURE_LABEL, type Allowance } from "@/lib/usage";

const pct = (n: number) => `${Math.min(100, Math.round(n))}%`;
const resets = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long" });

export default function UsagePage() {
  const [allowance, setAllowance] = useState<Allowance | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Loaded once when the page opens, then again only when asked for.
  const load = useCallback(async () => {
    setRefreshing(true);
    setFailed(false);
    const { data, error } = await supabase.rpc("my_ai_allowance");
    if (error || !data) setFailed(true);
    else setAllowance(data as unknown as Allowance);
    setRefreshing(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const used = allowance ? Math.min(100, allowance.used_pct) : 0;
  const features = allowance ? Object.keys(FEATURE_LABEL).filter((f) => f in allowance.features) : [];
  const hasWeek = !!allowance && allowance.week_pct !== null && Object.keys(allowance.week_features).length > 0;
  const week = allowance && hasWeek ? Math.min(100, allowance.week_pct ?? 0) : 0;
  // A feature is paused by its week or its month, whichever is used up.
  const paused = (f: string) => !!allowance && (allowance.features[f] >= 100 || (allowance.week_features[f] ?? 0) >= 100);
  const weekPaused = (f: string) => !!allowance && (allowance.week_features[f] ?? 0) >= 100 && allowance.features[f] < 100;

  return (
    <SettingsPage title="Usage">
      {failed && (
        <Alert variant="destructive">
          <AlertTitle>Could Not Load Your AI Allowance</AlertTitle>
          <AlertDescription>
            <p>Check your connection and try again.</p>
            <Button variant="secondary" className="mt-2" disabled={refreshing} onClick={() => void load()}>Retry</Button>
          </AlertDescription>
        </Alert>
      )}
      {!allowance ? (
        failed ? null : <SettingsSection id="ai" title="AI Allowance"><SettingsBody><Skeleton className="h-32 w-full rounded-lg" /></SettingsBody></SettingsSection>
      ) : (
        <SettingsSection id="ai" title="AI Allowance" action={<IconAction label="Refresh" icon={RefreshCw} disabled={refreshing} onClick={() => void load()} className={refreshing ? "[&_svg]:animate-spin" : undefined} />}>
          <SettingsRows>
            {hasWeek && (
              <div className="space-y-2 p-3">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">This Week: {pct(100 - week)} left</span>
                  <span className="text-xs text-muted-foreground">Resets {resets(allowance.week_resets_at)}</span>
                </div>
                <Progress value={week} aria-label="AI allowance used this week" />
              </div>
            )}
            <div className="space-y-2 p-3">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium">This Month: {pct(100 - used)} left</span>
                <span className="text-xs text-muted-foreground">Resets {resets(allowance.resets_at)}</span>
              </div>
              <Progress value={used} aria-label="AI allowance used this month" />
              {used >= 80 && (
                <p className="text-xs text-muted-foreground">
                  {used >= 100 ? "You have used this month's allowance. Features that are used up pause until it resets." : "You are close to this month's allowance."}
                </p>
              )}
            </div>
            {features.map((f) => (
              <SettingsRow key={f} title={FEATURE_LABEL[f]} description={paused(f) ? `Paused until ${weekPaused(f) ? resets(allowance.week_resets_at) : resets(allowance.resets_at)}` : undefined}>
                <span className="text-sm tabular-nums">{pct(allowance.features[f])} used</span>
              </SettingsRow>
            ))}
          </SettingsRows>
        </SettingsSection>
      )}
      <StorageSection />
    </SettingsPage>
  );
}
