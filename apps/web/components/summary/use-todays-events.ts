"use client";

// Today's calendar events for the Summary page: loaded for the signed in user, refreshed every few minutes and when the
// tab is visited again, kept between visits so the section is there at once. Which events still count is in
// lib/summary-list.ts; the in-memory copy is in lib/todays-events-cache.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { dayKey, daysOf, loadEvents, type CalendarEvent } from "@/lib/calendar";
import { unfinishedEvents } from "@/lib/summary-list";
import { cacheEvents, cachedEvents } from "@/lib/todays-events-cache";

/** Refetches today's events this often, which also retries a failed load. */
const EVENTS_REFRESH_MINUTES = 5;
/** Coming back to the tab refetches only if the last load is older than this, so a meeting added at 09:10 shows when you look. */
const FOCUS_REFETCH_MS = 60_000;

/**
 * Today's events that have not finished yet, all-day ones first. Undefined until the first load. The
 * last events loaded stay up while a refetch or a new day's load runs, and when one fails. `failed` is
 * set while the latest load has failed with nothing loaded to show, and `retry` loads again.
 */
export function useTodaysEvents(now: Date) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const today = dayKey(now);
  const tick = Math.floor(now.getTime() / (EVENTS_REFRESH_MINUTES * 60_000));
  const [loaded, setLoaded] = useState<CalendarEvent[] | undefined>(() => cachedEvents(userId, today));
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const lastLoad = useRef(0);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const [y, m, d] = today.split("-").map(Number);
    loadEvents(new Date(y, m - 1, d), new Date(y, m - 1, d + 1))
      .then((events) => {
        if (cancelled) return;
        cacheEvents(userId, today, events);
        lastLoad.current = Date.now();
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

  // Calendar rows have no realtime feed here, so a visit to the tab is the moment to look again.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoad.current > FOCUS_REFETCH_MS) setAttempt((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

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
