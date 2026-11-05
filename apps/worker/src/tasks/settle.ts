// Waiting for a claimed task change to be settled by someone else: the AI worker's iCloud Reminders connector makes
// the changes the sync worker claims for Reminders (connectors/icloud-reminders.ts). Pure, so it is tested without a database.

import { TaskUpdateError } from "./rows";

/** The connector looks for claimed changes every 3 to 30 seconds; this allows for a sign-in or a short backoff too. */
export const SETTLE_TIMEOUT_MS = 10 * 60_000;
export const SETTLE_POLL_MS = 2_000;
export const NOT_ANSWERED = "iCloud Reminders did not answer in time. Try again.";

/**
 * Resolves once a claimed change is no longer "updating" (settled, done or failed, or removed), and throws
 * NOT_ANSWERED once `timeoutMs` has gone by. `read` gives the row's status, null when it is gone.
 */
export async function waitUntilSettled(
  read: () => Promise<string | null>,
  opts: { wait?: (ms: number) => Promise<void>; now?: () => number; timeoutMs?: number; pollMs?: number } = {},
) {
  const { wait = (ms) => new Promise<void>((done) => setTimeout(done, ms)), now = Date.now, timeoutMs = SETTLE_TIMEOUT_MS, pollMs = SETTLE_POLL_MS } = opts;
  const until = now() + timeoutMs;
  for (;;) {
    if ((await read()) !== "updating") return;
    if (now() >= until) throw new TaskUpdateError(NOT_ANSWERED);
    await wait(pollMs);
  }
}
