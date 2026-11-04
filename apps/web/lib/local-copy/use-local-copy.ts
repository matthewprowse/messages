// The store's side of the device copy (sealed-copy.ts): shows the copy the moment a signed-in app opens, and saves the
// list back now and then. If the first load fails while the copy shows, the copy stays and the load is retried
// (first-load.ts). Privacy model: the copy is sealed on this device with a non-exportable key and cleared on
// sign-out (lib/auth.tsx); what is saved is the list, contacts and small tables, never message bodies.
//
// Saving waits for the network load to land (a copy is never saved from a copy), then runs in idle time at most once
// every SAVE_GAP_MS, however many realtime changes arrive, and once more when the app is hidden, as it may be closed.

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { Action, State } from "../app-store/reducer";
import type { Loaded } from "../data/load-threads";
import { EMPTY_PROFILE } from "../data/map-small";
import { deviceCopy } from "./device-copy";
import { type FirstLoad, loadOverCopy } from "./first-load";
import { snapshotOf, withCopy } from "./snapshot";

/** Wait after the first load lands before the first save, so the burst of follow-up changes is in it. */
const SETTLE_MS = 3_000;
/** Least time between two saves. */
const SAVE_GAP_MS = 30_000;
/** Longest an idle-time save waits for the browser to go idle. */
const IDLE_TIMEOUT_MS = 10_000;

const whenIdle = (run: () => void) => {
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
  else setTimeout(run, 0);
};

/** Calls done after ms, or at once when the browser comes back online or the app back into view. Returns a stop. */
function sleepUntilWoken(ms: number, done: () => void): () => void {
  let over = false;
  const wake = () => { if (document.visibilityState === "visible") finish(); };
  const timer = setTimeout(() => finish(), ms);
  window.addEventListener("online", wake);
  document.addEventListener("visibilitychange", wake);
  function stop() {
    clearTimeout(timer);
    window.removeEventListener("online", wake);
    document.removeEventListener("visibilitychange", wake);
  }
  function finish() {
    if (over) return;
    over = true;
    stop();
    done();
  }
  return stop;
}

export function useLocalCopy({ userId, state, rawDispatch }: { userId: string | null; state: State; rawDispatch: React.Dispatch<Action> }) {
  const stateRef = useRef(state);
  stateRef.current = state;
  const userRef = useRef(userId);
  userRef.current = userId;

  /**
   * Opens the copy for this user and shows it, unless the load already landed, and runs the first full load over it
   * (first-load.ts): while the copy shows, a failed load keeps the copy and tries again until it lands. `base` is the
   * state when the load began. The copy's rows go into the base too: otherwise the merge would read them as changes
   * made here meanwhile, keep them over the server's, and bring back conversations deleted since the copy was saved.
   */
  const showCopy = useCallback((forUser: string, base: State, load: () => Promise<Loaded>): FirstLoad<Loaded, State> => {
    let cancelled = false;
    let copyBase: State | undefined;
    deviceCopy()?.open(forUser).then((data) => {
      if (cancelled || !data) return;
      copyBase = { ...base, ...withCopy(base, data, EMPTY_PROFILE), fromCopy: true };
      rawDispatch({ type: "copied", data });
    }).catch(() => undefined);
    const first = loadOverCopy({
      load,
      firstBase: () => copyBase ?? base,
      baseNow: () => stateRef.current,
      showingCopy: () => stateRef.current.fromCopy,
      onKept: () => { toast("Showing your last saved inbox. Could not refresh."); },
      sleep: sleepUntilWoken,
    });
    return { landed: first.landed, cancel: () => { cancelled = true; first.cancel(); } };
  }, [rawDispatch]);

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dirty = useRef(false);
  const lastSaved = useRef(0);

  const save = useCallback((forUser: string) => {
    const s = stateRef.current;
    const store = deviceCopy();
    if (!dirty.current || !store || userRef.current !== forUser || s.loading || s.fromCopy) return;
    dirty.current = false;
    lastSaved.current = Date.now();
    store.save(forUser, snapshotOf(s)).catch(() => { dirty.current = true; });
  }, []);

  // Every change to what the copy holds marks it unsaved; one timer at a time carries it, so a burst is one save.
  const fresh = !!userId && !state.loading && !state.fromCopy;
  const { threads, contacts, accounts, rules, writingExamples, profile, unsubscribes, tasks } = state;
  useEffect(() => {
    if (!fresh || !userId) return;
    dirty.current = true;
    if (timer.current) return;
    const wait = Math.max(SETTLE_MS, lastSaved.current + SAVE_GAP_MS - Date.now());
    timer.current = setTimeout(() => { timer.current = undefined; lastSaved.current = Date.now(); whenIdle(() => save(userId)); }, wait);
  }, [fresh, userId, save, threads, contacts, accounts, rules, writingExamples, profile, unsubscribes, tasks]);

  // Hidden is the last sure moment before a phone closes the app. A new user starts with nothing pending.
  useEffect(() => {
    if (!userId) return;
    const onHide = () => {
      if (document.visibilityState !== "hidden" || !dirty.current) return;
      clearTimeout(timer.current);
      timer.current = undefined;
      save(userId);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      clearTimeout(timer.current);
      timer.current = undefined;
      dirty.current = false;
      lastSaved.current = 0;
    };
  }, [userId, save]);

  return { showCopy };
}
