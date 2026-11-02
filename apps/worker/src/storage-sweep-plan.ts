// The decision half of storage-sweep.ts: which queued storage paths to remove and which to just forget. Pure (no database),
// so the ref counting is tested without one.

export const MAX_ATTEMPTS = 5;

export type QueuedRemoval = { id: string; path: string; attempts: number };

/**
 * Splits queued paths into the ones to remove from storage and the ones to just forget (a row points at them again).
 */
export function planSweep(queued: QueuedRemoval[], stillReferenced: ReadonlySet<string>): { remove: QueuedRemoval[]; forget: QueuedRemoval[] } {
  const remove: QueuedRemoval[] = [];
  const forget: QueuedRemoval[] = [];
  for (const q of queued) (stillReferenced.has(q.path) ? forget : remove).push(q);
  return { remove, forget };
}

/** Whether a queued removal has failed too often to keep trying (the row is left for a person to look at). */
export const gaveUp = (q: Pick<QueuedRemoval, "attempts">) => q.attempts >= MAX_ATTEMPTS;
