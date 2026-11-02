// A counter that goes up when the next snoozed conversation is due back, so the lists and the Summary are worked out
// again then and it reappears on time, without polling. Also ticks when the tab wakes, as sleeping tabs delay timers.

import { useEffect, useMemo, useState } from "react";
import { nextReturn } from "../snooze";
import type { Thread } from "../types";

/** Longest setTimeout allows (about 24.8 days); a later return waits for the next tick. */
const MAX_WAIT_MS = 2 ** 31 - 1;
/** A beat past the return time, so the comparison is settled when the lists are worked out again. */
const SLACK_MS = 500;

export function useSnoozeClock(threads: Thread[]): number {
  const [tick, setTick] = useState(0);
  // tick is a dependency on purpose: it makes the next return be found again after one passes.
  const next = useMemo(() => nextReturn(threads), [threads, tick]);
  useEffect(() => {
    if (next === undefined) return;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.min(MAX_WAIT_MS, Math.max(0, next - Date.now() + SLACK_MS)));
    return () => clearTimeout(timer);
  }, [next]);
  useEffect(() => {
    const wake = () => { if (document.visibilityState === "visible") setTick((n) => n + 1); };
    document.addEventListener("visibilitychange", wake);
    return () => document.removeEventListener("visibilitychange", wake);
  }, []);
  return tick;
}
