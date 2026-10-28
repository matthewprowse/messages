// Decides which users the contact linker needs to look at in a run. A user is skipped when nothing the matcher reads
// has changed since their last run (their contacts, identities or address book cards), except that they are still
// run again every REFRESH_MS (new signatures in recent email can reveal a phone number without touching a contact)
// and fully every FULL_MS, a safety net for anything the change check cannot see (a deleted row, a clock skew).

/** A user is run again at least this often even when nothing seems to have changed. */
export const REFRESH_MS = 6 * 60 * 60_000;
/** Every user is run at least this often, whatever the change check says. */
export const FULL_MS = 24 * 60 * 60_000;
/** Timestamps are read from the database and compared with the worker's clock: this much slack against skew. */
export const SKEW_MS = 60_000;

export interface Gate {
  /** When each user was last run (worker clock). */
  lastRun: Map<string, number>;
  /** When the last full run started. */
  lastFull: number;
  /** When the last change check started, or null before the first. */
  checkedAt: number | null;
}

export const newGate = (): Gate => ({ lastRun: new Map(), lastFull: 0, checkedAt: null });

/** The ISO time to look for changes after: the last check minus slack, or null for "everything" (the first run or a full run). */
export function changedSince(gate: Gate, now: number): string | null {
  if (gate.checkedAt === null || now - gate.lastFull >= FULL_MS) return null;
  return new Date(gate.checkedAt - SKEW_MS).toISOString();
}

/**
 * The users to run now. `changed` is the users with a change since changedSince(), or "all" when the check hit its
 * row limit or was a full check. Records the run in the gate.
 */
export function pickUsers(gate: Gate, users: string[], changed: Set<string> | "all", now: number): string[] {
  const full = changed === "all" || now - gate.lastFull >= FULL_MS;
  const picked = users.filter((u) => full || changed.has(u) || now - (gate.lastRun.get(u) ?? 0) >= REFRESH_MS);
  for (const u of picked) gate.lastRun.set(u, now);
  if (full) gate.lastFull = now;
  gate.checkedAt = now;
  for (const u of gate.lastRun.keys()) if (!users.includes(u)) gate.lastRun.delete(u);
  return picked;
}
