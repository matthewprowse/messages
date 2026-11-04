"use client";

// Admin's Overview, Alerts: what needs the owner now (billing paused, a lease out, daily AI spend past the limit, a model
// with no price, a stuck queue), worked out from the live numbers on each load, and the daily spend limit itself. Nothing
// is sent: this card is the alert, and the Overview count counts it. The rules are lib/admin-ops.ts buildAlerts.

import { useState } from "react";
import { BellRing, Wallet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { Alert } from "@/lib/admin-ops";
import { Card, IconCircle, Row, Separated } from "@/components/surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingCard, Quiet } from "./parts";

/** The daily limit: a dollar amount from 0 up, where 0 turns the spend alert off. Amber from 80% of it, red past it. */
function DailyLimit({ value, onSaved }: { value: number; onSaved: () => void }) {
  const [text, setText] = useState(String(value));
  const [busy, setBusy] = useState(false);
  const n = text.trim() === "" ? Number.NaN : Number(text);
  const valid = Number.isFinite(n) && n >= 0 && n <= 100000;
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("admin_set_setting", { p_key: "daily_ai_alert_usd", p_value: n });
    setBusy(false);
    if (error) return void toast.error("Could Not Save The Limit");
    toast.success("Daily Spend Limit Saved");
    onSaved();
  };
  return (
    <Row
      lead={<IconCircle icon={Wallet} />}
      title="Daily AI Spend Limit"
      detail="0 Turns The Alert Off"
      end={
        <>
          <Input aria-label="Daily AI spend limit in dollars" aria-invalid={!valid || undefined} inputMode="decimal" className="h-8 w-20 text-right" value={text} onChange={(e) => setText(e.target.value)} />
          <Button variant="secondary" disabled={!valid || busy || n === value} onClick={() => void save()}>Save</Button>
        </>
      }
    />
  );
}

export function Alerts({ alerts, loaded, dailyLimitUsd, onSaved }: { alerts: Alert[]; loaded: boolean; dailyLimitUsd: number | null; onSaved: () => void }) {
  if (!loaded) return <LoadingCard title="Alerts" />;
  return (
    <Card title="Alerts">
      {alerts.length === 0 && <Quiet>All Clear</Quiet>}
      <Separated>
        {alerts.map((a) => (
          <Row
            key={a.id}
            lead={<IconCircle icon={BellRing} className={a.level === "red" ? "text-destructive" : undefined} />}
            title={a.title}
            detail={a.detail}
            end={<Badge variant={a.level === "red" ? "destructive" : "outline"}>{a.level === "red" ? "Act Now" : "Watch"}</Badge>}
          />
        ))}
        {dailyLimitUsd != null && <DailyLimit key={dailyLimitUsd} value={dailyLimitUsd} onSaved={onSaved} />}
      </Separated>
    </Card>
  );
}
