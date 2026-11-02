// Delete My Account, the parts both the page and /api/account/delete need: the grace period, the typed word, and how a pending
// request reads. Pure. The worker (apps/worker/src/account/delete-account.ts) carries the deletion out after the grace period
// and keeps its own copy of GRACE_DAYS in step: the comment there says so.

/** Days between asking and deleting, during which the request can be cancelled. */
export const GRACE_DAYS = 7;

const DAY_MS = 86_400_000;

/** When a request made now is carried out. */
export const runAfterFor = (now: number): string => new Date(now + GRACE_DAYS * DAY_MS).toISOString();

/** Whether what was typed is the confirmation word. Exact, in capitals, so it cannot be done by a stray Enter. */
export const isDeleteWord = (typed: string): boolean => typed.trim() === "DELETE";

/** Whether what was typed is the word that confirms removing a connected account. */
export const isRemoveWord = (typed: string): boolean => typed.trim() === "REMOVE";

export interface PendingDeletion { run_after: string; status: string; error_code?: string | null }

/** The sentence under the banner: when everything goes, or that it is being deleted now. */
export function pendingText(row: PendingDeletion, now: number): string {
  const at = Date.parse(row.run_after);
  if (row.status === "running" || at <= now) return "Your data is being deleted now.";
  const days = Math.ceil((at - now) / DAY_MS);
  const date = new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return `Everything will be deleted on ${date} (${days === 1 ? "in 1 day" : `in ${days} days`}). Until then you can cancel.`;
}

/** Cancelling is only possible while the worker has not started. */
export const canCancel = (row: PendingDeletion): boolean => row.status !== "running";
