// The Calendar page's reload signal: a version number that goes up when the days shown should load again, one
// debounced `reload` for everything that asks (Realtime, the dialogs, a delete), and `later` for changes the
// worker has not confirmed yet. Not a data loader: use-calendar-data.ts watches `version`.

import { useCallback, useEffect, useRef, useState } from "react";

export function useReload() {
  const [version, setVersion] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Several things can ask for the days to load again at once (Realtime, the dialog and a delete): they load once.
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reload = useCallback(() => {
    clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => setVersion((v) => v + 1), 300);
  }, []);
  useEffect(() => () => clearTimeout(reloadTimer.current), []);
  // A change the worker has not confirmed after a minute may still land: the days load again a while later, and what
  // is still missing from them is then dropped from the page.
  const later = useCallback((settle: () => void) => {
    setTimeout(() => {
      if (!mounted.current) return;
      settle();
      reload();
    }, 30_000);
  }, [reload]);

  return { version, setVersion, mounted, reload, later };
}
