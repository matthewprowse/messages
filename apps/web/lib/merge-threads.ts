// Applies a catch-up's changed conversations to the list that is held.

import type { Thread } from "./types";

/** The listed threads with these changed ones: replaced, added, or dropped when deleted (in the provider's bin). Newest first. */
export function mergeThreads(current: Thread[], changed: Thread[], gone: Set<string>): Thread[] {
  const byId = new Map(current.map((t) => [t.id, t]));
  for (const t of changed) {
    if (gone.has(t.id)) byId.delete(t.id);
    else byId.set(t.id, t);
  }
  return [...byId.values()].sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : a.lastMessageAt > b.lastMessageAt ? -1 : 0));
}
