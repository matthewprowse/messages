"use client";

// Once the app has loaded and the browser is idle, loads the messages of the few conversations most likely to be opened
// next (lib/app-store/prefetch-picks.ts), so opening one does not wait on a read from far away. Once per sign-in, a
// couple at a time, and not at all when the browser asks to save data. Loading only reads the database: nothing is marked
// read and no read receipt goes out. Renders nothing.

import { useEffect, useRef } from "react";
import { useApp } from "@/lib/store";
import { IDLE_PREFETCH_CONCURRENCY, idlePrefetchIds } from "@/lib/app-store/prefetch-picks";
import { runPooled } from "@/lib/app-store/run-pooled";

/** How long to wait for an idle moment before going ahead anyway. */
const IDLE_TIMEOUT_MS = 5000;

type IdleWindow = Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };

/** True when the browser has Data Saver or Low Data Mode on (Chromium only; elsewhere unknown, so false). */
function savesData(): boolean {
  return !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
}

export function IdlePrefetch() {
  const { loading, threads, messagesLoaded, prefetchMessages } = useApp();
  const latest = useRef({ threads, messagesLoaded });
  latest.current = { threads, messagesLoaded };
  const done = useRef(false);

  useEffect(() => {
    if (loading || done.current || savesData()) return;
    const w = window as IdleWindow;
    let cancelled = false;
    // Picked when the idle moment comes, from the list as it is then. Marked done only here, so an effect torn down
    // before it (Strict Mode runs effects twice in development) schedules it again.
    const run = () => {
      if (cancelled || done.current) return;
      done.current = true;
      const { threads: now, messagesLoaded: loaded } = latest.current;
      const ids = idlePrefetchIds(now, loaded);
      void runPooled(ids.map((id) => () => (cancelled ? undefined : prefetchMessages(id))), IDLE_PREFETCH_CONCURRENCY);
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
      return () => { cancelled = true; w.cancelIdleCallback?.(id); };
    }
    const id = window.setTimeout(run, 1500); // Safari has no requestIdleCallback: a pause after the first paint instead
    return () => { cancelled = true; window.clearTimeout(id); };
  }, [loading, prefetchMessages]);

  return null;
}
