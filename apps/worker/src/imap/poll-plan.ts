// How often an IMAP connection runs its housekeeping tick, and how many ticks pass between the slower jobs. Each
// account already holds one connection that sits in IDLE, so new Inbox mail and flag changes arrive at once; the tick is
// only the safety net (IDLE sometimes misses an arrival) and the way other folders are noticed (a STATUS each). With
// IDLE the tick is slow; a server without IDLE has only the tick, so it stays at a minute. The slower jobs keep their
// wall-clock spacing whatever the tick, so slowing it does not make them rarer than they were.

export interface ImapPollPlan {
  tickMs: number;
  /** Ticks between full Inbox reconciles (every 5 minutes). */
  reconcileEvery: number;
  /** Ticks between looks for files that failed to save (every 10 minutes). */
  filesEvery: number;
  /** Ticks between reads of the account for edited send addresses (every 10 minutes). */
  selfEvery: number;
}

const RECONCILE_MS = 5 * 60_000;
const FILES_MS = 10 * 60_000;
const SELF_MS = 10 * 60_000;

export function imapPollPlan(hasIdle: boolean, idleTickMs: number, noIdleTickMs: number): ImapPollPlan {
  const tickMs = hasIdle ? idleTickMs : noIdleTickMs;
  const every = (ms: number) => Math.max(1, Math.round(ms / tickMs));
  return { tickMs, reconcileEvery: every(RECONCILE_MS), filesEvery: every(FILES_MS), selfEvery: every(SELF_MS) };
}
