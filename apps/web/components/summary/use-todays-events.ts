"use client";

// Today's calendar events for the Summary page: loaded for the signed in user, refreshed every few minutes, kept
// between visits so the section is there at once. Which events still count is in lib/summary-list.ts.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { dayKey, daysOf, loadEvents, type CalendarEvent } from "@/lib/calendar";
import { unfinishedEvents } from "@/lib/summary-list";

/** Refetches today's events this often, which also retries a failed load. */
const EVENTS_REFRESH_MINUTES = 5;

/**
 * Today's events that have not finished yet, all-day ones first. Undefined until the first load. The
 * last events loaded stay up while a refetch or a new day's load runs, and when one fails. `failed` is
 * set while the latest load has failed with nothing loaded to show, and `retry` loads again.
 */
// Today's events as last loaded, so the section is there at once when the page is opened again.
let todaysCache: { userId: string; day: string; events: CalendarEvent[] } | null = null;

export function useTodaysEvents(now: Date) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const today = dayKey(now);
  const tick = Math.floor(now.getTime() / (EVENTS_REFRESH_MINUTES * 60_000));
  const [loaded, setLoaded] = useState<CalendarEvent[] | undefined>(() => (todaysCache && todaysCache.userId === userId && todaysCache.day === today ? todaysCache.events : undefined));
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const [y, m, d] = today.split("-").map(Number);
    loadEvents(new Date(y, m - 1, d), new Date(y, m - 1, d + 1))
      .then((events) => {
        if (cancelled) return;
        todaysCache = { userId, day: today, events };
        setLoaded(events);
        setFailed(false);
      })
      .catch((err) => {
        console.error(err instanceof Error ? err.message : "Load events failed");
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, today, tick, attempt]);

  const retry = useCallback(() => {
    setFailed(false);
    setAttempt((n) => n + 1);
  }, []);

  const events = useMemo(
    () => loaded && unfinishedEvents(loaded, (e) => daysOf(e, [today]).length > 0, now),
    [loaded, today, now],
  );
  return { events, failed: failed && !loaded, retry };
}
