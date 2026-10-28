// What a worker does about work a stopped worker left half done, safe with several workers.
//
// The old startup did "fail every row in flight". With two workers that would fail the other one's live sends. Now each
// worker only settles rows of accounts it owns (shard.ts), and the lease (lease.ts) guarantees nobody else is running
// that shard, so an in-flight row of an owned account at startup can only be left over from a dead run of this shard.
// Rows whose account cannot be worked out (a conversation or task that is gone) belong to nobody: only shard 0 settles
// those, and only once they are older than a grace period, so a row being created right now is never touched.
//
// A row in flight is failed, never retried, when the send may already have happened (an email, a calendar change, an
// unsubscribe, a task tick). A mail action is idempotent, so it goes back to queued instead.

import { db, must } from "./db";
import { planRecovery, type InFlightRow } from "./recovery-plan";
import { isPrimaryShard, ownsAccount } from "./shard";
import { MAYBE_CREATED } from "./calendar/create-event";
import { INTERRUPTED as EVENT_UPDATE_INTERRUPTED } from "./calendar/update-queue";
import { INTERRUPTED as TASK_INTERRUPTED } from "./tasks/rows";
import { WORKING_STALE_MS } from "./send/actions";

interface Spec {
  table: string;
  status: string;
  /** How the row names its account. */
  via: "account_id" | "thread" | "task_or_account";
  patch: () => Record<string, unknown>;
}

const doneNow = () => new Date().toISOString();

const SPECS: Spec[] = [
  { table: "outbox", status: "sending", via: "thread", patch: () => ({ status: "failed", error: "Sending was interrupted. Check your Sent folder before trying again." }) },
  { table: "calendar_outbox", status: "creating", via: "account_id", patch: () => ({ status: "failed", error: MAYBE_CREATED, done_at: doneNow() }) },
  // The same words as calendar/delete-event.ts failInterruptedDeletes.
  { table: "calendar_deletes", status: "deleting", via: "account_id", patch: () => ({ status: "failed", error: "Deleting this event was interrupted. Reload to check whether it is gone.", done_at: doneNow() }) },
  { table: "calendar_updates", status: "updating", via: "account_id", patch: () => ({ status: "failed", error: EVENT_UPDATE_INTERRUPTED, done_at: doneNow() }) },
  { table: "task_updates", status: "updating", via: "task_or_account", patch: () => ({ status: "failed", error: TASK_INTERRUPTED }) },
  // The same words as the old startup step in index.ts.
  { table: "unsubscribes", status: "working", via: "account_id", patch: () => ({ status: "failed", error: "Unsubscribing was interrupted. Try again if their emails keep coming.", done_at: doneNow() }) },
];

// The query builder is typed per table; these helpers are table-agnostic, so they go through a loose view of the client.
type Loose = { from(table: string): any };
const loose = db as unknown as Loose;

const CHUNK = 200;

/** Looks up each row's account where the row names a conversation or a task instead. */
type RawRow = { id: string; created_at: string; claimed_at?: string | null; account_id?: string | null; thread_id?: string | null; task_id?: string | null };

async function resolve(rows: RawRow[]): Promise<InFlightRow[]> {
  const threadIds = [...new Set(rows.flatMap((r) => (!r.account_id && r.thread_id ? [r.thread_id] : [])))];
  const taskIds = [...new Set(rows.flatMap((r) => (!r.account_id && r.task_id ? [r.task_id] : [])))];
  const threadAccount = new Map<string, string>();
  const taskAccount = new Map<string, string>();
  for (let i = 0; i < threadIds.length; i += CHUNK) {
    const found = must(await db.from("threads").select("id, account_id").in("id", threadIds.slice(i, i + CHUNK)), "load interrupted rows' conversations");
    for (const t of found) threadAccount.set(t.id, t.account_id);
  }
  for (let i = 0; i < taskIds.length; i += CHUNK) {
    const found = must(await db.from("tasks").select("id, account_id").in("id", taskIds.slice(i, i + CHUNK)), "load interrupted rows' tasks");
    for (const t of found) if (t.account_id) taskAccount.set(t.id, t.account_id);
  }
  return rows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    claimed_at: r.claimed_at,
    accountId: r.account_id ?? (r.thread_id ? threadAccount.get(r.thread_id) : undefined) ?? (r.task_id ? taskAccount.get(r.task_id) : undefined) ?? null,
  }));
}

async function settle(spec: Spec) {
  const columns = spec.via === "thread" ? "id, created_at, account_id, thread_id" : spec.via === "task_or_account" ? "id, created_at, account_id, task_id" : "id, created_at, account_id";
  const read = must(await loose.from(spec.table).select(columns).eq("status", spec.status).limit(500), `load interrupted ${spec.table}`) as RawRow[];
  if (read.length === 0) return;
  const rows = await resolve(read);
  const ids = planRecovery(rows, { owns: ownsAccount, primary: isPrimaryShard, now: Date.now() });
  for (let i = 0; i < ids.length; i += CHUNK) {
    // Only rows still in the state: one that finished while this ran is left alone.
    must(await loose.from(spec.table).update(spec.patch()).eq("status", spec.status).in("id", ids.slice(i, i + CHUNK)), `fail interrupted ${spec.table}`);
  }
}

/**
 * Startup: settles what a stopped run of this shard left in flight (sends, calendar and task changes, unsubscribes).
 * Replaces the per-table failInterrupted* calls, which touched every account's rows.
 */
export async function failInterruptedWork() {
  for (const spec of SPECS) await settle(spec);
}

/**
 * Mail actions left 'working' go back to queued once. At startup `olderThan` is omitted (every owned row is a leftover); the
 * periodic call passes the age after which a claim is stale and the ids this worker is still applying. How long a row has
 * been claimed is claimed_at where the column exists (migration 20261109100600), else created_at.
 */
export async function requeueWorkingActions(olderThan?: Date, skip: ReadonlySet<string> = new Set()) {
  let read = await loose.from("mail_actions").select("id, created_at, claimed_at, thread_id").eq("status", "working").limit(500);
  if (read.error?.code === "42703") read = await loose.from("mail_actions").select("id, created_at, thread_id").eq("status", "working").limit(500);
  const raw = (must(read, "load working mail actions") as RawRow[]).filter((r) => !skip.has(r.id));
  if (raw.length === 0) return;
  const rows = await resolve(raw);
  const minAgeMs = olderThan ? Date.now() - olderThan.getTime() : 0;
  const ids = planRecovery(rows, { owns: ownsAccount, primary: isPrimaryShard, now: Date.now(), minAgeMs });
  for (let i = 0; i < ids.length; i += CHUNK) {
    must(await loose.from("mail_actions").update({ status: "queued" }).eq("status", "working").in("id", ids.slice(i, i + CHUNK)), "requeue working mail actions");
  }
}

/** The age after which the periodic pass treats a claimed mail action as left over. */
export const STALE_ACTION_MS = WORKING_STALE_MS;
