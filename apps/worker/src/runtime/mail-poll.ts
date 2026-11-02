// How often a mail connector checks its mailbox now that Gmail, Outlook and IMAP can be told when mail arrives.
// Pure logic, so it is testable on its own.
//
// Push (Gmail Pub/Sub, Outlook change notifications) wakes the connector the moment something changes, so the timer
// is only a safety net and runs slowly. Without push configured, or with push that is not working (a watch that failed,
// a subscription Graph refused), the old activity based cadence stays, so mail never arrives later than it used to.

import type { PollPlan } from "../polling";
import { nextPollDelay } from "../polling";

function ms(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** "off": push is not configured. "healthy": it is set up for this account. "failing": it is configured but could not be set up. */
export type PushState = "off" | "healthy" | "failing";

/** The slow safety-net poll for Gmail and Outlook (MAIL_SLOW_POLL_MS), 5 minutes by default. */
export const MAIL_SLOW_POLL_MS = ms("MAIL_SLOW_POLL_MS", 5 * 60_000);

/** IMAP's own tick (side folders by STATUS, the Inbox check) while IDLE is available (IMAP_POLL_MS), 5 minutes by default. */
export const IMAP_POLL_MS = ms("IMAP_POLL_MS", 5 * 60_000);

/** IMAP's tick on a server without IDLE, where the poll is the only way to see new mail (IMAP_NO_IDLE_POLL_MS). */
export const IMAP_NO_IDLE_POLL_MS = ms("IMAP_NO_IDLE_POLL_MS", 60_000);

/** How long to wait before the next Gmail or Outlook check. `plan` is the activity based cadence used when push is failing. */
export function mailPollDelay(state: PushState, plan: PollPlan, lastActivity: number, now: number, slowMs = MAIL_SLOW_POLL_MS): number {
  if (state === "healthy") return slowMs;
  return nextPollDelay(now, lastActivity, plan);
}
