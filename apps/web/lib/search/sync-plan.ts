// Works out what to send the index when the app's own lists change (conversations, contacts, tasks): only documents that
// differ from what was sent last time, and the ids of ones that have gone. Pure. Without this, every Realtime change to
// one conversation would rewrite a thousand documents.

import type { Doc } from "./types";

export interface SyncPlan {
  upserts: Doc[];
  /** Documents that were in the last list and are not in this one. Documents never seen by the plan are never removed by it. */
  removed: string[];
  /** Pass this back as `prev` next time. */
  state: Map<string, string>;
}

/** Compares the documents made from the current list with the ones sent last time. */
export function planSync(prev: Map<string, string>, next: Doc[]): SyncPlan {
  const state = new Map<string, string>();
  const upserts: Doc[] = [];
  for (const d of next) {
    const key = JSON.stringify(d);
    state.set(d.id, key);
    if (prev.get(d.id) !== key) upserts.push(d);
  }
  const removed = [...prev.keys()].filter((id) => !state.has(id));
  return { upserts, removed, state };
}
