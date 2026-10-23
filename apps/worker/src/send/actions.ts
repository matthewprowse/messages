import { db } from "../db";

// mail_actions rows (read, archive, react and the rest) are finished the same way by every connector.

/** Marks an action done, or failed with a reason the app can show. Never throws: the row is retried by nobody. */
export async function finishAction(id: string, error?: string) {
  const done_at = new Date().toISOString();
  await db
    .from("mail_actions")
    .update(error ? { status: "failed", error, done_at } : { status: "done", done_at })
    .eq("id", id)
    .then(() => undefined, () => undefined);
}
