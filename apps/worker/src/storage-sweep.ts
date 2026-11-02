// Removes the storage objects a user deleted on the Attachments page (public.delete_attachment_files queues them in
// storage_deletions). Identical files are stored once, so an object is only removed when no attachment row still
// points at it; the check is made again here because a new duplicate may have been filed since it was queued.
// The decision is in storage-sweep-plan.ts; this file is the I/O.

import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "./db";
import { errorCode, log } from "./log";
import { ATTACHMENTS_BUCKET } from "./storage";
import { MAX_ATTEMPTS, planSweep, type QueuedRemoval } from "./storage-sweep-plan";

const BATCH = 50;

// storage_deletions is not in the generated types for this client until they are regenerated.
const loose = () => db as unknown as SupabaseClient;

/** One pass over the queue. Quiet (a log line) when the migration has not been applied yet. */
export async function sweepDeletedFiles(): Promise<number> {
  const { data, error } = await loose().from("storage_deletions").select("id, path, attempts").lt("attempts", MAX_ATTEMPTS).order("created_at").limit(BATCH);
  if (error) {
    log.warn("storage sweep skipped", { code: error.code ?? "UNKNOWN" });
    return 0;
  }
  const queued = (data ?? []) as QueuedRemoval[];
  if (queued.length === 0) return 0;

  // Which paths some attachment row still points at, by any of the three columns.
  const referenced = new Set<string>();
  for (const column of ["storage_path", "thumb_path", "team_path"] as const) {
    const { data: rows, error: refError } = await loose().from("attachments").select(column).in(column, queued.map((q) => q.path));
    if (refError) { log.warn("storage sweep check failed", { code: refError.code ?? "UNKNOWN" }); return 0; }
    for (const r of (rows ?? []) as unknown as Record<string, string>[]) referenced.add(r[column]);
  }
  const { remove, forget } = planSweep(queued, referenced);

  let removed = remove.length;
  if (remove.length > 0) {
    const { error: removeError } = await db.storage.from(ATTACHMENTS_BUCKET).remove(remove.map((q) => q.path));
    if (removeError) {
      log.warn("storage remove failed", { code: errorCode(removeError) });
      for (const q of remove) await loose().from("storage_deletions").update({ attempts: q.attempts + 1 }).eq("id", q.id);
      remove.length = 0;
      removed = 0;
    }
  }
  const done = [...remove, ...forget].map((q) => q.id);
  if (done.length > 0) await loose().from("storage_deletions").delete().in("id", done);
  return removed;
}
