// The database and storage side of the two account jobs, and the loops that run them from maintenance (runtime/maintenance.ts):
// Delete My Account requests past their grace period (delete-account.ts) and queued account removals (remove-account.ts).
// Uses the service role, so every query names the user or account. Logs ids and codes only, never names, addresses or content.

import { startEvery } from "../backoff";
import { allRows, db, must } from "../db";
import { readByIds } from "../in-chunks";
import { errorCode, log } from "../log";
import { chunks } from "../util";
import { deleteEverything, isDue, MAX_ATTEMPTS, type DeleteDeps } from "./delete-account";
import { objectsToDelete, sharedCandidates, type FileRow } from "./remove-account";
import { removeObjects, type StorageEntry, type StorageLister } from "./storage-sweep";

const storage: StorageLister = {
  async list(bucket, folder, offset, pageSize): Promise<StorageEntry[]> {
    const { data, error } = await db.storage.from(bucket).list(folder, { limit: pageSize, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw Object.assign(new Error("storage list failed"), { code: "STORAGE" });
    // A folder comes back with no id.
    return (data ?? []).map((e) => ({ name: e.name, isFolder: e.id === null }));
  },
  async remove(bucket, paths) {
    if (paths.length === 0) return;
    const { error } = await db.storage.from(bucket).remove(paths);
    if (error) throw Object.assign(new Error("storage remove failed"), { code: "STORAGE" });
  },
};

// Delete My Account -----------------------------------------------------------------------------------------------------

const realDeps: DeleteDeps = {
  storage,
  async ownsTeamWithMembers(userId) {
    const owned = must(await db.from("workspaces").select("id").eq("owner_id", userId), "load owned teams");
    if (owned.length === 0) return false;
    const { count, error } = await db.from("workspace_members").select("user_id", { count: "exact", head: true })
      .in("workspace_id", owned.map((w) => w.id)).eq("status", "active").neq("user_id", userId);
    if (error) throw Object.assign(new Error("count team members failed"), { code: error.code });
    return (count ?? 0) > 0;
  },
  async stopSyncing(userId) {
    const accounts = must(await db.from("accounts").select("id").eq("user_id", userId), "load accounts");
    const ids = accounts.map((a) => a.id);
    if (ids.length === 0) return;
    must(await db.from("accounts").update({ status: "disconnected" }).eq("user_id", userId).select("id"), "disconnect accounts");
    for (const slice of chunks(ids, 100)) {
      must(await db.from("account_credentials").delete().in("account_id", slice).select("account_id"), "drop credentials");
      must(await db.from("whatsapp_auth_keys").delete().in("account_id", slice).select("account_id"), "drop whatsapp keys");
    }
  },
  async teamFilePaths(userId) {
    const rows = await allRows((from, to) => db.from("attachments").select("id, team_path").eq("user_id", userId).not("team_path", "is", null).order("id").range(from, to), "load team files");
    return rows.map((r) => r.team_path).filter((p): p is string => !!p);
  },
  async removeEmptyTeams(userId) {
    const owned = must(await db.from("workspaces").select("id").eq("owner_id", userId), "load owned teams");
    for (const w of owned) {
      const { count, error } = await db.from("workspace_members").select("user_id", { count: "exact", head: true }).eq("workspace_id", w.id).eq("status", "active").neq("user_id", userId);
      if (error) throw Object.assign(new Error("count team members failed"), { code: error.code });
      if ((count ?? 0) === 0) must(await db.from("workspaces").delete().eq("id", w.id).select("id"), "delete empty team");
    }
  },
  async shredKeys(userId) {
    must(await db.from("user_keys").delete().eq("user_id", userId).select("user_id"), "shred key");
  },
  async deleteAuthUser(userId) {
    const { error } = await db.auth.admin.deleteUser(userId);
    // Already gone counts as done: a retry after a crash between this call and the row check must finish.
    if (error && !/not.?found/i.test(error.message)) throw Object.assign(new Error("delete user failed"), { code: String((error as { status?: number }).status ?? "AUTH") });
  },
  async tablesWithRows(userId, tables) {
    const left: string[] = [];
    for (const table of tables) {
      // The table list is typed as names that exist, so the cast only widens the literal for the generic client.
      const { count, error } = await db.from(table as "notes").select("*", { count: "exact", head: true }).eq("user_id" as "id", userId);
      if (error) throw Object.assign(new Error("count rows failed"), { code: error.code ?? "COUNT" });
      if ((count ?? 0) > 0) left.push(table);
    }
    return left;
  },
};

/** Carries out every Delete My Account request that is due. One at a time, oldest first. */
export async function runAccountDeletions() {
  const now = Date.now();
  const rows = must(await db.from("account_deletions").select("user_id, status, run_after, attempts, started_at").lte("run_after", new Date(now).toISOString()).order("run_after").limit(10), "load deletions");
  for (const row of rows.filter((r) => isDue(r, now))) {
    // Claim by compare and set, so a second worker that read the same row does nothing.
    const claimed = must(await db.from("account_deletions").update({ status: "running", started_at: new Date().toISOString(), attempts: row.attempts + 1 })
      .eq("user_id", row.user_id).eq("attempts", row.attempts).select("user_id"), "claim deletion");
    if (claimed.length === 0) continue;
    try {
      const { objects } = await deleteEverything(realDeps, row.user_id);
      log.info("account deleted", { objects });
    } catch (err) {
      const code = errorCode(err);
      log.error("account deletion failed", { user: row.user_id, code, attempts: row.attempts + 1, giveUp: row.attempts + 1 >= MAX_ATTEMPTS });
      // The row is still there unless the auth user went; if it is gone this update matches nothing.
      await db.from("account_deletions").update({ status: "failed", error_code: code.slice(0, 40) }).eq("user_id", row.user_id);
    }
  }
}

// Remove one account ---------------------------------------------------------------------------------------------------

/** The attachment rows of one account, with the paths they point at. */
async function filesOfAccount(userId: string, accountId: string): Promise<FileRow[]> {
  const rows = await allRows(
    (from, to) => db.from("attachments").select("id, storage_path, thumb_path, team_path, messages!inner(account_id)").eq("user_id", userId).eq("messages.account_id", accountId).order("id").range(from, to),
    "load account files",
  );
  return rows.map((r) => ({ id: r.id, accountId, storagePath: r.storage_path, thumbPath: r.thumb_path, teamPath: r.team_path }));
}

/** Rows of this person's other accounts that point at any of these paths. */
async function sharingRows(userId: string, accountId: string, paths: string[]): Promise<FileRow[]> {
  const out: FileRow[] = [];
  for (const column of ["storage_path", "thumb_path", "team_path"] as const) {
    const rows = await readByIds(paths, (slice) => db.from("attachments").select("id, storage_path, thumb_path, team_path, messages!inner(account_id)").eq("user_id", userId).in(column, slice), "load sharing files");
    for (const r of rows) {
      const owner = (r.messages as unknown as { account_id: string }).account_id;
      if (owner !== accountId) out.push({ id: r.id, accountId: owner, storagePath: r.storage_path, thumbPath: r.thumb_path, teamPath: r.team_path });
    }
  }
  return out;
}

/** Removes the accounts queued by request_account_removal: their files first, then the account row, which takes the rest with it. */
export async function runAccountRemovals() {
  const jobs = must(await db.from("account_removals").select("id, user_id, account_id, status, attempts").in("status", ["queued", "failed"]).lt("attempts", MAX_ATTEMPTS).order("created_at").limit(10), "load removals");
  for (const job of jobs) {
    const claimed = must(await db.from("account_removals").update({ status: "running", attempts: job.attempts + 1 }).eq("id", job.id).eq("attempts", job.attempts).select("id"), "claim removal");
    if (claimed.length === 0) continue;
    try {
      const mine = await filesOfAccount(job.user_id, job.account_id);
      const others = await sharingRows(job.user_id, job.account_id, sharedCandidates(mine));
      // The attachments bucket holds all three kinds of path (own file, thumbnail, team copy).
      const count = await removeObjects(storage, "attachments", objectsToDelete(mine, others));
      must(await db.from("accounts").delete().eq("id", job.account_id).eq("user_id", job.user_id).select("id"), "delete account");
      log.info("account removed", { account: job.account_id, objects: count });
    } catch (err) {
      const code = errorCode(err);
      log.error("account removal failed", { account: job.account_id, code });
      await db.from("account_removals").update({ status: "failed", error_code: code.slice(0, 40) }).eq("id", job.id);
    }
  }
}

const ACCOUNT_JOBS_MS = 5 * 60_000; // how often due deletions and queued removals are looked for

/** Starts both loops, on shard 0 only (the claim steps above make a second runner harmless). */
export function startAccountJobs() {
  startEvery(60_000, ACCOUNT_JOBS_MS, runAccountRemovals, (err) => log.error("account removals failed", { code: errorCode(err) }));
  startEvery(90_000, ACCOUNT_JOBS_MS, runAccountDeletions, (err) => log.error("account deletions failed", { code: errorCode(err) }));
}
