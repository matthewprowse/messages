// The always-on sync worker. Every 30 seconds it reconciles running connectors with the accounts table (a
// light read; only accounts that start are read in full and decrypted):
// new accounts start, disconnected ones stop, and accounts with fresh credentials restart. Work queued
// in the app (replies and new emails, mail actions, unsubscribes, calendar events, ticked tasks) arrives through
// Realtime and a safety-net poll (every 2 minutes in use, 10 minutes when quiet, and once on every Realtime
// reconnect), and is handed to the account's connector. Alongside run photo sync, the contact
// linker, and a daily cleanup of files sent with old outbox rows.
//
// Several workers can share the load (WORKER_SHARD_INDEX / WORKER_SHARD_COUNT, see shard.ts and the README): each runs
// connectors only for the accounts it owns and leaves queued rows of other accounts alone. Jobs that must run once
// (below, "primary shard") run on shard 0 only. A lease per shard (lease.ts) stops two workers running the same shard.

// Where things live: runtime/state.ts (running connectors, hand-off), runtime/reconcile.ts, runtime/queues.ts (Realtime and
// the poll) with the runtime/dispatch-*.ts modules it calls, runtime/maintenance.ts and runtime/shutdown.ts.

import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import { db } from "./db";
import { env } from "./env";
import { log, errorCode } from "./log";
import { startPhotoSync } from "./photos/job";
import { startCompanyLogos } from "./logos/job";
import { startContactLinker } from "./contacts/linker";
import { startAddressIndexer } from "./address-indexer";
import { startMeetingLinker } from "./meetings/linker";
import { startShareJobs } from "./share/job";
import { startTeamKeyRotation } from "./share/rotate";
import { startTeamRules } from "./share/team-store";
import { startUsageRollup } from "./usage-rollup";
import { isPrimaryShard } from "./shard";
import { failInterruptedWork, requeueWorkingActions } from "./recovery";
import { Lease } from "./lease";
import { startPushSender } from "./push/sender";
import { startOutboxCleanup } from "./send/outbox-attachments";
import { startStorageMaintenance } from "./runtime/maintenance";
import { startAccountJobs } from "./account/jobs";
import { watchQueues } from "./runtime/queues";
import { reconcile, watchAccounts } from "./runtime/reconcile";
import { stopAndExit } from "./runtime/shutdown";
import { countSync, reportError, startOps } from "./ops";

const RECONCILE_MS = 30_000;
const USAGE_ROLLUP_MS = 24 * 60 * 60_000;

async function main() {
  log.info("worker starting", { shard: env.shardIndex, shards: env.shardCount });
  let lease: Lease | undefined;
  const health = startOps(); // health endpoint (HEALTH_PORT), error reporting and the metrics log line; see ops/ and docs/RUNBOOK.md
  process.on("unhandledRejection", (err) => reportError(err, "unhandled_rejection"));
  process.on("uncaughtException", (err) => { reportError(err, "uncaught_exception"); void stopAndExit(1, lease); }); // state after one is unknown: leave cleanly and let the supervisor restart

  // One worker per shard. Taken before anything starts, so a second worker for this shard exits without touching a row.
  if (env.lease) {
    const name = `shard-${env.shardIndex}`;
    lease = new Lease({
      db,
      name,
      holder: `${hostname()}-${process.pid}-${randomBytes(4).toString("hex")}`,
      log,
      onLost: () => { health.setLeaseHeld(false); void stopAndExit(1); }, // never keep running without the lease
    });
    const got = await lease.start();
    if (got === "taken") {
      log.error("shard lease is held by another worker, exiting", { lease: name, code: "LEASE_TAKEN" });
      process.exit(1);
    }
    if (got === "unleased") lease = undefined;
  } else {
    log.warn("WORKER_LEASE is off: nothing stops a second worker for this shard");
  }

  // Settle what a stopped run of this shard left half done (only rows of accounts this shard owns; see recovery.ts).
  await Promise.all([
    failInterruptedWork(), // sends, calendar events, deletes and changes, task ticks and unsubscribes cut off by a restart may have happened, so they are failed, not repeated
    requeueWorkingActions(), // a mail action a stopped worker left half-claimed is idempotent, so it runs again once
  ]);
  await reconcile();
  health.tick();
  watchAccounts();
  watchQueues();

  // Primary shard (0) only: jobs that read or change data across all users and are not written to run twice at once.
  //  - photos: address-book imports match across a person's accounts, which may sit on different shards, and the shared company icons;
  //  - logos: one shared company queue; contacts and addresses: whole-table scans and merges that would race each other;
  //  - meetings: links across providers; usage rollup: a single table fold; outbox cleanup: sweeps old files;
  //  - share jobs, key rotation, team rules: re-seal and share chats under keys that must change once;
  //  - push: reads every person's new Urgent and Important threads in one pass.
  if (isPrimaryShard) {
    startPhotoSync();
    startCompanyLogos();
    startOutboxCleanup();
    startContactLinker(); // finds and merges contacts that are one person
    startAddressIndexer(); // blind indexes for rows written without one
    startMeetingLinker(); // ties Teams, Zoom and Meet meetings to contacts and calendar events
    startUsageRollup(USAGE_ROLLUP_MS); // folds ai_usage rows older than 90 days into monthly totals
    startShareJobs(); // moves chats marked as work (or moved back) between the agent's key and the team's
    startTeamKeyRotation(); // new team key version after a member leaves, then re-seals the team's content under it
    startTeamRules(); // shares chats with team clients (or suggests them), and suggests chats triage marked as work
    startStorageMaintenance();
    startPushSender(); // content-free web push for Urgent and Important messages, within each person's settings
    startAccountJobs(); // Delete My Account after its grace period, and Remove Account
  } else {
    log.info("not the primary shard: shared jobs run on shard 0", { shard: env.shardIndex });
  }
  setInterval(() => reconcile().then(() => { health.tick(); countSync("reconcile"); }).catch((err) => reportError(err, "reconcile")), RECONCILE_MS);

  const shutdown = async () => {
    log.info("worker stopping");
    await stopAndExit(0, lease);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log.error("worker failed to start", { code: errorCode(err) });
  process.exit(1);
});
