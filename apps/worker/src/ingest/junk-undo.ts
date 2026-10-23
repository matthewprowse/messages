import type { db as Db } from "../db";

// A conversation the AI sorted into Junk was never in the provider's spam. Taking it out of Junk only
// moves mail that really was in spam, and undoing that (a spam action straight after) only puts that
// mail back, so AI junk never moves mail in the provider.

/** How long after a Not Junk a spam action on the same conversation counts as its undo. */
export const UNDO_WINDOW_MS = 2 * 60 * 1000;

export interface ActionStamp {
  action: string;
  created_at: string;
}

/** Whether a spam action is the undo of the Not Junk queued just before it. Pure, for tests. */
export function isUndoOfUnspam(row: ActionStamp, previous: ActionStamp | null): boolean {
  if (row.action !== "spam" || !previous || previous.action !== "unspam") return false;
  const gap = Date.parse(row.created_at) - Date.parse(previous.created_at);
  return gap >= 0 && gap <= UNDO_WINDOW_MS;
}

/**
 * Looks up the action queued on the same conversation just before this one. The client is passed in so
 * this file stays free of the database connection and can be unit tested.
 */
export async function undoesNotJunk(db: typeof Db, row: ActionStamp & { id: string; thread_id: string }): Promise<boolean> {
  if (row.action !== "spam") return false;
  const { data, error } = await db
    .from("mail_actions")
    .select("action, created_at")
    .eq("thread_id", row.thread_id)
    .neq("id", row.id)
    .lte("created_at", row.created_at)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw Object.assign(new Error("load previous action failed"), { code: error.code });
  return isUndoOfUnspam(row, data?.[0] ?? null);
}
