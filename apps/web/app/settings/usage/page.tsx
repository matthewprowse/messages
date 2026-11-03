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
import { SettingsHeader } from "@/components/settings-header";
import { SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";
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
    <>
      <SettingsHeader
        title="Usage"
        description="Your AI allowance for the month, then your storage."
        actions={allowance && (
          <Button variant="secondary" disabled={refreshing} onClick={() => void load()}>
            <RefreshCw className={refreshing ? "animate-spin" : undefined} /> Refresh
          </Button>
        )}
      />
      <div className="space-y-3">
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
          failed ? null : <Skeleton className="h-40 w-full rounded-lg" />
        ) : (
          <SettingsSection id="ai" title="AI Allowance" description="What the AI uses for sorting, drafts and transcripts. Setting up a newly connected account is free and not counted. The week starts again on Monday and the month on the first.">
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
      </div>
    </>
  );
}
