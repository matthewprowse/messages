// Which in-flight rows a worker may settle at startup. Pure (no database or env import), so it is testable on its own.
// See recovery.ts for why: with several workers a worker settles only the rows of accounts it owns, and shard 0 alone
// settles rows whose account cannot be worked out, once they are older than a grace period.

/** How old an in-flight row of an unknown account must be before shard 0 settles it. */
export const ORPHAN_GRACE_MS = 3 * 60_000;

export interface InFlightRow {
  id: string;
  created_at: string;
  claimed_at?: string | null;
  /** The account, when the row names one directly or it has been looked up through its conversation or task. Null when it cannot be resolved. */
  accountId: string | null;
}

export interface PlanOptions {
  owns: (accountId: string) => boolean;
  primary: boolean;
  now: number;
  /** How old an unresolvable row must be before the primary shard settles it. */
  graceMs?: number;
  /** How long a row must have been in flight before it counts as left over, for rows of owned accounts. 0 at startup. */
  minAgeMs?: number;
}

/** The ids to settle: owned rows older than minAgeMs, and (primary shard only) unresolvable rows older than the grace period. */
export function planRecovery(rows: InFlightRow[], o: PlanOptions): string[] {
  const graceMs = o.graceMs ?? ORPHAN_GRACE_MS;
  const minAgeMs = o.minAgeMs ?? 0;
  const out: string[] = [];
  for (const row of rows) {
    const since = Date.parse(row.claimed_at ?? row.created_at);
    const age = Number.isNaN(since) ? Infinity : o.now - since;
    if (row.accountId) {
      if (o.owns(row.accountId) && age >= minAgeMs) out.push(row.id);
    } else if (o.primary && age >= Math.max(graceMs, minAgeMs)) {
      out.push(row.id);
    }
  }
  return out;
}
