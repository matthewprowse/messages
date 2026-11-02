// Carries out a Delete My Account request once its 7 day grace period is over. Pure orchestration: the database and storage calls
// come in through DeleteDeps (jobs.ts has the real ones, the tests use fakes), so the order of the steps is what is tested.
//
// The order matters. Syncing stops first so nothing new arrives; files go before rows because storage is not covered by the
// database cascade; the wrapped keys go before the auth user so the data is unreadable even in a backup taken meanwhile
// (crypto-shredding, docs/PLAN.md); and the auth user last, because every user_id table cascades from it. A final count per
// table fails the job loudly if anything of the person is left, rather than reporting a deletion that did not finish.

import { emptyFolder, type StorageLister } from "./storage-sweep";
import { OWNED_TABLES, USER_BUCKETS } from "./owned-tables";

/** Days between the request and the deletion, during which it can be cancelled. The app shows the same number. */
export const GRACE_DAYS = 7;
/** A job that failed this many times is left for a person to look at. */
export const MAX_ATTEMPTS = 5;
/** A job marked running longer than this was lost with a stopped worker and may be taken again. */
export const STALE_RUNNING_MS = 30 * 60_000;

export interface DeletionRow { status: string; run_after: string; attempts: number; started_at: string | null }

/** Whether a request is ready to carry out: past its grace period, not out of attempts, and not being worked on by a live worker. */
export function isDue(row: DeletionRow, now: number): boolean {
  if (row.attempts >= MAX_ATTEMPTS || Date.parse(row.run_after) > now) return false;
  if (row.status === "pending" || row.status === "failed") return true;
  return row.status === "running" && !!row.started_at && now - Date.parse(row.started_at) > STALE_RUNNING_MS;
}

/** What the steps need from the database and storage. */
export interface DeleteDeps {
  storage: StorageLister;
  /** True when the person owns a team that still has other active members. They must hand it over first. */
  ownsTeamWithMembers(userId: string): Promise<boolean>;
  /** Disconnects every account and drops its stored sign-in, so no connector runs for them. */
  stopSyncing(userId: string): Promise<void>;
  /** Storage paths of the team copies of this person's shared files (outside their own folder). */
  teamFilePaths(userId: string): Promise<string[]>;
  /** Deletes the teams they own that have no other active member, so no empty team is left without an owner. */
  removeEmptyTeams(userId: string): Promise<void>;
  /** Deletes their wrapped data key. */
  shredKeys(userId: string): Promise<void>;
  /** Deletes the auth user, which cascades to every row they own. */
  deleteAuthUser(userId: string): Promise<void>;
  /** The tables (by name) that still hold rows for them. */
  tablesWithRows(userId: string, tables: readonly string[]): Promise<string[]>;
}

/** An error with a stable code, which is all that is stored or logged. */
const failed = (code: string, what: string) => Object.assign(new Error(what), { code });

/** Deletes everything the person owns. Throws with a code (TEAM_OWNER, LEFTOVER_ROWS, or the step's own) and may be run again. */
export async function deleteEverything(deps: DeleteDeps, userId: string): Promise<{ objects: number }> {
  if (await deps.ownsTeamWithMembers(userId)) throw failed("TEAM_OWNER", "owns a team with members");
  await deps.stopSyncing(userId);
  let objects = 0;
  // Team copies first: they are found through attachment rows, which the auth user's deletion would remove.
  const teamPaths = await deps.teamFilePaths(userId);
  for (let i = 0; i < teamPaths.length; i += 100) await deps.storage.remove("attachments", teamPaths.slice(i, i + 100));
  objects += teamPaths.length;
  for (const bucket of USER_BUCKETS) objects += await emptyFolder(deps.storage, bucket, userId);
  await deps.shredKeys(userId);
  await deps.removeEmptyTeams(userId);
  await deps.deleteAuthUser(userId);
  const left = await deps.tablesWithRows(userId, OWNED_TABLES);
  if (left.length > 0) throw failed("LEFTOVER_ROWS", `rows left in ${left.join(", ")}`);
  return { objects };
}
