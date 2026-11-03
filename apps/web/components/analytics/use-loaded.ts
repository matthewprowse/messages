"use client";

// Loads one analytics result for Admin when it is wanted (a view that shows it is open) and again when its inputs change.
// A failure keeps what is already on screen; "denied" is the database refusing a non-owner. use-analytics.ts holds one for
// Overview's health and one for the Usage and AI summary.

import { useCallback, useEffect, useRef, useState } from "react";
import { AnalyticsError } from "@/lib/analytics-data";

export interface Loaded<T> {
  data: T | null;
  /** When `data` was loaded, ms since the epoch. */
  at: number;
  busy: boolean;
  failed: boolean;
  denied: boolean;
  refresh: () => void;
}

/** `load` must be stable for the same inputs (wrap it in useCallback); it runs on mount while `enabled`, and whenever it changes. */
export function useLoaded<T>(load: () => Promise<T>, enabled: boolean): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [denied, setDenied] = useState(false);
  const latest = useRef(0);

  const run = useCallback(async () => {
    const id = ++latest.current;
    setBusy(true);
    setFailed(false);
    try {
      const next = await load();
      if (id !== latest.current) return;
      setData(next);
      setAt(Date.now());
    } catch (e) {
      if (id !== latest.current) return;
      if (e instanceof AnalyticsError && e.kind === "denied") setDenied(true);
      else setFailed(true);
    } finally {
      if (id === latest.current) setBusy(false);
    }
  }, [load]);

  useEffect(() => {
    if (enabled) void run();
  }, [enabled, run]);

  return { data, at, busy, failed, denied, refresh: () => void run() };
}
