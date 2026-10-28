// mail_actions rows (read, archive, react and the rest) are finished the same way by every connector.

import { db, retryWrite } from "../db";

/** Marks an action done, or failed with a reason the app can show. Retried on a database error; never throws. */
export async function finishAction(id: string, error?: string) {
  const done_at = new Date().toISOString();
  await retryWrite(() =>
    db.from("mail_actions").update(error ? { status: "failed", error, done_at } : { status: "done", done_at }).eq("id", id),
  ).catch(() => false);
}

/** Whether the action is still queued. A stale poll list can hold one that was finished meanwhile. */
export async function stillQueued(id: string): Promise<boolean> {
  const { data, error } = await db.from("mail_actions").select("status").eq("id", id).maybeSingle();
  // Unreadable: apply it rather than drop it; the apply is idempotent state (read, archive).
  if (error) return true;
  return data?.status === "queued";
}
