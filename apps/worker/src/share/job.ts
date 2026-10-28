import { db, must } from "../db";
import { errorCode, log } from "../log";
import { fillClients } from "./clients";
import { runShareJob, type ShareJob } from "./process";
import { keys, supabaseFiles, supabaseStore } from "./store";
import { clientStore } from "./team-store";

// Works the share jobs queued when a chat is marked as work or moved back, and the follow-ups queued when new
// content arrives in a shared chat (20261101120000_shared_chats.sql). A new job arrives through Realtime at once,
// with a poll as a safety net, and also picks up jobs that failed and are due again or were left working by a crash.

const POLL_MS = 15_000;
/** How long to leave the queue alone when its function is missing, because the migration has not been applied yet. */
const MISSING_WAIT_MS = 10 * 60_000;

/** Takes the next job that can run, or null. The database hands each out once and one per chat at a time. */
async function claim(): Promise<ShareJob | null> {
  const [job] = must(await db.rpc("claim_share_job"), "claim share job");
  return job ? { id: job.id, thread_id: job.thread_id, workspace_id: job.workspace_id, direction: job.direction as ShareJob["direction"] } : null;
}

async function finish(id: string, status: "done" | "failed", error: string | null) {
  must(await db.from("share_jobs").update({ status, error, finished_at: new Date().toISOString() }).eq("id", id), "finish share job");
}

/**
 * After a chat is shared, its people join the team's client list (clients.ts). Best effort: the chat itself is shared
 * and the job is done whatever happens here, and the next follow-up for the chat tries again.
 */
async function fillClientList(job: ShareJob) {
  try {
    const thread = await supabaseStore.thread(job.thread_id);
    if (!thread || thread.workspace_id !== job.workspace_id) return;
    const out = await fillClients(thread, clientStore, keys);
    if (out.added || out.failed) log.info("team clients filled", { job: job.id, added: out.added, skipped: out.skipped, failed: out.failed });
  } catch (err) {
    log.warn("team clients not filled", { job: job.id, code: errorCode(err) });
  }
}

/** Works the job, and records how it went. Nothing about the chat's content is ever logged: ids, counts and codes only. */
async function work(job: ShareJob) {
  try {
    const outcome = await runShareJob(job, supabaseStore, keys, supabaseFiles);
    if (outcome.state === "incomplete") {
      log.warn("share job incomplete", { job: job.id, direction: job.direction, moved: outcome.moved, failed: outcome.failed });
      await finish(job.id, "failed", outcome.failed ? `${outcome.failed} rows could not be moved` : "rows kept changing");
      return;
    }
    log.info("share job done", { job: job.id, direction: job.direction, state: outcome.state, moved: outcome.moved });
    await finish(job.id, "done", null);
    if (job.direction === "to_work") await fillClientList(job);
  } catch (err) {
    log.error("share job failed", { job: job.id, direction: job.direction, code: errorCode(err) });
    await finish(job.id, "failed", `error ${errorCode(err)}`).catch(() => undefined);
  }
}

export function startShareJobs() {
  let running = false;
  let again = false;
  let missingUntil = 0;
  const pass = async () => {
    if (running) { again = true; return; }
    if (Date.now() < missingUntil) return;
    running = true;
    try {
      do {
        again = false;
        for (let job = await claim(); job; job = await claim()) await work(job);
      } while (again);
    } catch (err) {
      if (errorCode(err) === "PGRST202") {
        missingUntil = Date.now() + MISSING_WAIT_MS;
        log.warn("share jobs wait for their migration (20261101120000_shared_chats.sql)");
      } else {
        log.error("share jobs failed", { code: errorCode(err) });
      }
    } finally {
      running = false;
    }
  };
  db.channel("share-jobs")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "share_jobs" }, () => void pass())
    .subscribe();
  void pass();
  setInterval(() => void pass(), POLL_MS);
}
