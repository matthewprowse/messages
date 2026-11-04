// Removes the files of messages you sent once they are done with, so sealed or not they do not sit in Storage: a day
// after a message was sent or failed, and a week for files of a message that never went or that no row points at any
// more (Undo deletes the row, an upload whose send was never queued, rows the retention job removed). The keep times
// and the path safety rule are in cleanup-rules.ts; this file is the I/O. A sent message keeps its own stored copy.

import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import { db, must } from "../db";
import { errorCode, log } from "../log";
import { startEvery } from "../backoff";
import { ATTACHMENTS_BUCKET, storageError } from "../storage";
import { outboxCleanupCutoffs, outboxOwner, removableOutboxPath } from "./cleanup-rules";

const CLEANUP_EVERY_MS = 60 * 60 * 1000; // hourly, so a sent file is gone within a day and an hour
const CLEANUP_FIRST_MS = 60_000;
const ORPHANS_EVERY_MS = 24 * 60 * 60 * 1000; // the orphan lookup reads storage.objects, so it runs once a day
const BATCH = 100;
const MAX_PASSES = 50; // per kind and run: 5,000 files, and the next run carries on

interface Doomed {
  id: string;
  user_id: string;
  storage_path: string;
}

type Load = (skipped: string[]) => PromiseLike<PostgrestSingleResponse<Doomed[]>>;

/** Removes the objects and rows `load` finds, a batch at a time. Returns how many files were removed. */
async function removeRows(what: string, load: Load): Promise<number> {
  let removed = 0;
  // Rows whose path is not ours to remove are left alone (rows and object both) and left out of the next read, so the loop ends.
  const skipped: string[] = [];
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const rows = must(await load(skipped), what);
    if (rows.length === 0) break;
    const ours = rows.filter((r) => removableOutboxPath(r.user_id, r.storage_path));
    for (const r of rows) if (!ours.includes(r)) skipped.push(r.id);
    if (ours.length < rows.length) log.warn("outbox files left in place", { skipped: skipped.length });
    if (ours.length) {
      const { error } = await db.storage.from(ATTACHMENTS_BUCKET).remove(ours.map((r) => r.storage_path));
      if (error) throw storageError("remove outbox files", error);
      must(await db.from("outbox_attachments").delete().in("id", ours.map((r) => r.id)), "delete old outbox attachments");
      removed += ours.length;
    }
    if (rows.length < BATCH) break;
  }
  return removed;
}

const COLUMNS = "id, user_id, storage_path, outbox!inner(status, sent_at, send_after)";

/** Leaves out the rows a pass has already skipped. */
function except<Q extends { not(column: string, operator: string, value: string): Q }>(query: Q, skipped: string[]): Q {
  return skipped.length ? query.not("id", "in", `(${skipped.join(",")})`) : query;
}

/** The files of rows that are done with them: sent a day ago, failed a day ago, or stuck for a week. */
async function cleanupDoneFiles(now: number): Promise<number> {
  const cut = outboxCleanupCutoffs(now);
  const rows = () => db.from("outbox_attachments").select(COLUMNS);
  const sent = await removeRows("load sent outbox attachments", (skipped) =>
    except(rows().eq("outbox.status", "sent").lt("outbox.sent_at", cut.sent), skipped).limit(BATCH));
  const failed = await removeRows("load failed outbox attachments", (skipped) =>
    except(rows().eq("outbox.status", "failed").lt("created_at", cut.failed), skipped).limit(BATCH));
  // A week old and not on its way: sent without a sent_at, left "sending", or queued and due more than a week ago (or
  // never given a time). A message scheduled for later keeps its files until a week after it was due.
  const old = await removeRows("load old outbox attachments", (skipped) =>
    except(rows().lt("created_at", cut.stuck).in("outbox.status", ["sent", "sending"]), skipped).limit(BATCH));
  const stuck = await removeRows("load stuck outbox attachments", (skipped) =>
    except(rows().lt("created_at", cut.stuck).eq("outbox.status", "queued").or(`send_after.is.null,send_after.lt.${cut.stuck}`, { referencedTable: "outbox" }), skipped).limit(BATCH));
  return sent + failed + old + stuck;
}

/** Objects in outbox folders that no row points at and were uploaded over a week ago. Quiet until the migration is in. */
async function cleanupOrphans(now: number): Promise<number> {
  const before = outboxCleanupCutoffs(now).stuck;
  let removed = 0;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const { data, error } = await db.rpc("orphan_outbox_files", { p_before: before, p_limit: BATCH });
    if (error) {
      // The function arrives with 20261125120000_sealed_outbox_files.sql.
      if (error.code === "PGRST202") return removed;
      throw Object.assign(new Error("load orphan outbox files failed"), { code: error.code });
    }
    const found = (data ?? []).map((r) => r.path);
    const ours = found.filter((path) => {
      const user = outboxOwner(path);
      return !!user && removableOutboxPath(user, path);
    });
    if (ours.length < found.length) log.warn("orphan outbox files left in place", { skipped: found.length - ours.length });
    if (ours.length === 0) break; // nothing removable: the same paths would only come back
    const { error: removeError } = await db.storage.from(ATTACHMENTS_BUCKET).remove(ours);
    if (removeError) throw storageError("remove orphan outbox files", removeError);
    removed += ours.length;
    if (found.length < BATCH) break;
  }
  return removed;
}

/** Runs the cleanup a minute after startup, then every hour; the orphan lookup at most once a day. */
export function startOutboxCleanup() {
  let orphansAt = 0;
  startEvery(
    CLEANUP_FIRST_MS,
    CLEANUP_EVERY_MS,
    async () => {
      const now = Date.now();
      const removed = await cleanupDoneFiles(now);
      if (removed > 0) log.info("outbox files removed", { removed });
      if (now - orphansAt >= ORPHANS_EVERY_MS) {
        const orphans = await cleanupOrphans(now);
        orphansAt = now;
        if (orphans > 0) log.info("orphan outbox files removed", { removed: orphans });
      }
    },
    (err) => log.warn("outbox cleanup failed", { code: errorCode(err) }),
  );
}
