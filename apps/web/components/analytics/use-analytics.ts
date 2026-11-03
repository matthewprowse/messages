"use client";

// The product analytics behind Admin's Overview, Usage and AI views: analytics_health for Overview (worked out from signup,
// so no period) and one summary for Usage and AI covering the period asked for and the one before it. Each loads only while
// a view that shows it is open, so opening Overview does not run the heavier summary and the other way round.

import { useCallback, useMemo } from "react";
import { loadSummary } from "@/lib/analytics-data";
import { loadHealth } from "@/lib/analytics-health";
import { build } from "./derive";
import { useLoaded } from "./use-loaded";
import type { Days } from "@/components/admin/view-params";

/** `health` and `summary` say which loads are wanted now; `exclude` leaves out the owner and test accounts. */
export function useAnalytics({ health: wantHealth, summary: wantSummary, days, exclude }: { health: boolean; summary: boolean; days: Days; exclude: boolean }) {
  const loadUsage = useCallback(async () => ({ summary: await loadSummary(days, exclude), days }), [days, exclude]);
  const loadHealthNow = useCallback(() => loadHealth(exclude), [exclude]);
  const usage = useLoaded(loadUsage, wantSummary);
  const health = useLoaded(loadHealthNow, wantHealth);
  const reports = useMemo(() => (usage.data ? build(usage.data.summary, usage.data.days) : null), [usage.data]);
  return { health, usage, reports, denied: health.denied || usage.denied };
}
