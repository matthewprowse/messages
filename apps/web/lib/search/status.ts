"use client";

// What the screens may know about the index: whether it is open, how far the first build has got ("Indexing 12,000 of
// 83,000") and a counter that moves when its contents change. A tiny external store, so a component reads it with
// useIndexProgress and nothing else in the app has to know the index exists.

import { useSyncExternalStore } from "react";
import type { IndexProgress } from "./types";

const CLOSED: IndexProgress = { ready: false, indexed: 0, total: null, building: false, rev: 0 };

let state: IndexProgress = CLOSED;
const listeners = new Set<() => void>();

/** Changes the progress. Listeners run only when something differs. */
export function setProgress(patch: Partial<IndexProgress>) {
  const next = { ...state, ...patch };
  if (next.ready === state.ready && next.indexed === state.indexed && next.total === state.total && next.building === state.building && next.rev === state.rev) return;
  state = next;
  for (const l of listeners) l();
}

/** Marks that the contents changed, for searches that are open. */
export function bumpRev() {
  setProgress({ rev: state.rev + 1 });
}

/** Back to the closed state (sign-out). */
export function resetProgress() {
  setProgress({ ...CLOSED, rev: state.rev + 1 });
}

export const progress = () => state;

/** The index's progress, live. */
export function useIndexProgress(): IndexProgress {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => state,
    () => CLOSED,
  );
}
