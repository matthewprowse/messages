"use client";

// Loads what the operator sections need in one go: system health, connector health, AI spend history, the billing state, the
// unpriced models and the daily spend limit. One load, so Health, Alerts and the tab badge never disagree. Owner only: every
// source refuses anyone else in the database. A section that fails shows its own message; the rest still load.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { ConnectorHealth, Health, History } from "@/lib/admin-ops";

export interface AdminOps {
  health: Health | null;
  connectors: ConnectorHealth | null;
  history: History | null;
  billingPausedSince: string | null;
  unpricedModels: string[];
  dailyLimitUsd: number | null;
  failed: { health: boolean; connectors: boolean; history: boolean };
  loaded: boolean;
}

const EMPTY: AdminOps = { health: null, connectors: null, history: null, billingPausedSince: null, unpricedModels: [], dailyLimitUsd: null, failed: { health: false, connectors: false, history: false }, loaded: false };

export function useAdminOps(version: number, onBusy: (busy: boolean) => void): AdminOps & { reload: () => void } {
  const [ops, setOps] = useState<AdminOps>(EMPTY);
  const [again, setAgain] = useState(0);

  const load = useCallback(async () => {
    onBusy(true);
    const [health, connectors, history, status, settings] = await Promise.all([
      supabase.rpc("admin_system_health"),
      supabase.rpc("admin_connector_health"),
      supabase.rpc("admin_ai_history"),
      supabase.from("ai_status").select("billing_paused_since, unpriced_models").maybeSingle(),
      supabase.from("admin_settings").select("value").eq("key", "daily_ai_alert_usd").maybeSingle(),
    ]);
    setOps({
      health: health.error ? null : (health.data as unknown as Health),
      connectors: connectors.error ? null : (connectors.data as unknown as ConnectorHealth),
      history: history.error ? null : (history.data as unknown as History),
      billingPausedSince: status.data?.billing_paused_since ?? null,
      unpricedModels: status.data?.unpriced_models ?? [],
      dailyLimitUsd: settings.data?.value ?? null,
      failed: { health: !!health.error, connectors: !!connectors.error, history: !!history.error },
      loaded: true,
    });
    onBusy(false);
  }, [onBusy]);
  useEffect(() => { void load(); }, [load, version, again]);

  return { ...ops, reload: useCallback(() => setAgain((n) => n + 1), []) };
}
