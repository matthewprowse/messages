// mail_actions rows (read, archive, react and the rest) are claimed, applied and finished the same way for every connector.

import type { Tables } from "@messages/db";
import { db, must, retryWrite } from "../db";

/** How long a row may stay 'working' before the poll treats its worker as gone and queues it again. */
export const WORKING_STALE_MS = 10 * 60 * 1000;

/** Thrown by a connector's applyAction while it is running but not connected yet: the row goes straight back to queued. */
export class NotReady extends Error {
  constructor() {
    super("connector not ready");
  }
}

/** Marks an action done, or failed with a reason the app can show. Retried on a database error; never throws. */
export async function finishAction(id: string, error?: string) {
  const done_at = new Date().toISOString();
  await retryWrite(() =>
    db.from("mail_actions").update(error ? { status: "failed", error, done_at } : { status: "done", done_at }).eq("id", id),
  ).catch(() => false);
}

/**
 * Takes a queued action for this run: queued becomes working in one statement, so the poll and Realtime cannot both
 * apply it (a second trash would lose the original "was in the inbox" for undo). Returns the claimed row, or null
 * when another run already has it or it is no longer queued.
 */
export async function claimAction(id: string): Promise<Tables<"mail_actions"> | null> {
  return must(
    await db.from("mail_actions").update({ status: "working" }).eq("id", id).eq("status", "queued").select().maybeSingle(),
    "claim mail action",
  );
}

/**
 * Claims the action, applies it, and makes sure it does not stay 'working' if applying throws. The connector finishes
 * the row itself on every normal path; a throw is failed here with a reason, never put back to queued, so a
 * permanently broken action cannot loop.
 */
export async function applyClaimed(id: string, apply: (row: Tables<"mail_actions">) => Promise<void>) {
  const row = await claimAction(id);
  if (!row) return;
  try {
    await apply(row);
  } catch (err) {
    if (err instanceof NotReady) {
      // Not claimed for real: queued again now, so the next poll retries it instead of waiting out the stale timeout.
      await retryWrite(() => db.from("mail_actions").update({ status: "queued" }).eq("id", id).eq("status", "working")).catch(() => false);
      return;
    }
    await finishAction(id, "Could not update your mail. It will match on the next change.");
    throw err;
  }
}
