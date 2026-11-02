// What happens to a queued email whose account is not connected. An account is in error for a moment while it
// reconnects, so an email to it waits a while and goes out if the account recovers; only then is it failed, with a
// reason that says to reconnect. A disconnected account will not recover by itself, so its email fails at once.

/** How long a queued email waits for its account to come back from an error. */
export const ACCOUNT_ERROR_WAIT_MS = 10 * 60_000;

export const BROKEN_ACCOUNT_REASON = "This account needs attention. Reconnect it in Settings, then send again.";

export type AccountVerdict = "send" | "wait" | "fail";

/** Whether a queued email made at queuedAt goes out now, waits for its account, or fails. */
export function accountVerdict(status: string | undefined, queuedAt: string, now = Date.now()): AccountVerdict {
  if (status === "disconnected") return "fail";
  if (status !== "error") return "send";
  const age = now - Date.parse(queuedAt);
  return Number.isFinite(age) && age < ACCOUNT_ERROR_WAIT_MS ? "wait" : "fail";
}
