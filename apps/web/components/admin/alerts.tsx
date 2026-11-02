"use client";

// Admin, Alerts: what needs the owner now (billing paused, a lease out, daily AI spend past the limit, a model with no price,
// a stuck queue), and the daily spend limit itself. Nothing is sent: this list is the alert, and the tab badge counts it.
// The rules are lib/admin-ops.ts buildAlerts.

import { useState } from "react";
import { BellRing, CircleCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { Alert } from "@/lib/admin-ops";
import { EmptyState } from "@/components/primitives";
import { AdminHeading, AdminRow } from "@/components/admin/parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

/** The daily limit box: a dollar amount from 0 up; 0 turns the spend alert off. */
function DailyLimit({ value, onSaved }: { value: number; onSaved: () => void }) {
  const [text, setText] = useState(String(value));
  const [busy, setBusy] = useState(false);
  const n = text.trim() === "" ? Number.NaN : Number(text);
  const valid = Number.isFinite(n) && n >= 0 && n <= 100000;
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("admin_set_setting", { p_key: "daily_ai_alert_usd", p_value: n });
    setBusy(false);
    if (error) return void toast.error("Could not save the limit.");
    toast.success("Daily spend limit saved.");
    onSaved();
  };
  return (
    <AdminRow title="Daily AI Spend Limit" description="Everyone's AI spend today, setup included. Amber from 80% of this, red past it. 0 turns the alert off.">
      <span className="text-sm text-muted-foreground">$</span>
      <Input aria-label="Daily AI spend limit in dollars" aria-invalid={!valid || undefined} inputMode="decimal" className="w-24 text-right" value={text} onChange={(e) => setText(e.target.value)} />
      <Button size="sm" disabled={!valid || busy || n === value} onClick={() => void save()}>Save</Button>
    </AdminRow>
  );
}

export function Alerts({ alerts, loaded, dailyLimitUsd, onSaved }: { alerts: Alert[]; loaded: boolean; dailyLimitUsd: number | null; onSaved: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <AdminHeading title="Alerts" description="Worked out from the live numbers each time you open or refresh Admin. Nothing is emailed." />
      {!loaded ? (
        <div className="flex flex-col gap-3"><Skeleton className="h-14 w-full rounded-lg" /><Skeleton className="h-14 w-full rounded-lg" /></div>
      ) : alerts.length === 0 ? (
        <div className="py-8"><EmptyState icon={CircleCheck} title="All Clear" description="Billing works, every worker is renewing, no queue is stuck and spend is under the limit." /></div>
      ) : (
        <div role="list">
          {alerts.map((a, i) => (
            <div key={a.id} role="listitem">
              {i > 0 && <Separator className="ml-3" />}
              <AdminRow icon={<BellRing />} title={<>{a.title}<Badge variant={a.level === "red" ? "destructive" : "outline"}>{a.level === "red" ? "Act Now" : "Watch"}</Badge></>} description={a.detail} />
            </div>
          ))}
        </div>
      )}
      <AdminHeading title="Limits" />
      {dailyLimitUsd != null && <DailyLimit key={dailyLimitUsd} value={dailyLimitUsd} onSaved={onSaved} />}
    </div>
  );
}
