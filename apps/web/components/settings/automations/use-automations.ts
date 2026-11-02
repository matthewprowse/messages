"use client";

// Loads the user's automations and their recent runs for the Automations page, and reloads them on demand. Runs are made by the AI
// worker, so the page also looks again every 20 seconds while it is open, which keeps a new lead's run in the history without Realtime.

import { useCallback, useEffect, useState } from "react";
import { loadAutomations, loadRuns, type Automation, type Run } from "@/lib/automations/io";

const REFRESH_MS = 20_000;

export function useAutomations() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [a, r] = await Promise.all([loadAutomations(), loadRuns()]);
      setAutomations(a);
      setRuns(r);
      setError(null);
    } catch {
      setError("Could not load your automations. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  return { automations, runs, loading, error, reload };
}
