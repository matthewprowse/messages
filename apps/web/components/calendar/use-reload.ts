// The Calendar page's reload signal: a version number that goes up when the days shown should load again, one
// debounced `reload` for everything that asks (Realtime, the dialogs, a delete, the tab coming back), and `later` for
// changes the worker has not confirmed yet. Not a data loader: use-calendar-data.ts watches `version`.

import { useCallback, useEffect, useRef, useState } from "react";

/** How long a change may take before the page stops waiting and checks once more. The worker is followed for up to a minute (followUpdate). */
export const LATE_MS = 60_000;

export function useReload() {
  const [version, setVersion] = useState(0);
  const mounted = useRef(true);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    mounted.current = true;
    const pending = timers.current;
    return () => {
      mounted.current = false;
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  // Several things can ask for the days to load again at once (Realtime, the dialog and a delete): they load once.
  // A busy sync worker sends a burst of changes; each one pushes the load back, so the burst loads once at its end.
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reload = useCallback(() => {
    clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => setVersion((v) => v + 1), 300);
  }, []);
  useEffect(() => () => clearTimeout(reloadTimer.current), []);
  // A change the worker has not confirmed after a minute may still land: the days load again then, and what is still
  // missing from them is dropped from the page.
  const later = useCallback((settle: () => void) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      if (!mounted.current) return;
      settle();
      reload();
    }, LATE_MS);
    timers.current.add(timer);
  }, [reload]);

  return { version, setVersion, mounted, reload, later };
}
