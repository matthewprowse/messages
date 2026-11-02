// A single-instance guard per shard. The worker takes a lease row in the database (acquire_worker_lease, migration
// 20261110100000_worker_leases.sql) before it starts anything, renews it while it runs and releases it on shutdown.
// A second worker for the same shard waits one lease lifetime and exits if the lease is still held (a lease left by a
// killed worker runs out in that time, so a quick restart starts late rather than not at all); a worker that loses its lease stops everything and exits,
// so two workers never run the same accounts. Pure logic over a tiny `rpc` interface, so it is testable with a fake.
//
// Until the migration is applied the functions do not exist: the worker warns once and runs without a lease, so the code
// can be deployed before the migration.

export interface LeaseDb {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
}

export interface LeaseLog {
  info(msg: string, fields?: Record<string, string | number | boolean | null | undefined>): void;
  warn(msg: string, fields?: Record<string, string | number | boolean | null | undefined>): void;
  error(msg: string, fields?: Record<string, string | number | boolean | null | undefined>): void;
}

export const LEASE_TTL_SECONDS = 90;
export const LEASE_RENEW_MS = 30_000;
/** After a failed renewal, how soon to try again. */
export const LEASE_RETRY_MS = 5_000;
/** Give up this long before the lease would expire: after that another worker may already hold it. */
export const LEASE_SAFETY_MS = 10_000;

/** A call that has not answered by now counts as failed: a hung renewal must not let the lease lapse unnoticed. */
export const LEASE_RPC_TIMEOUT_MS = 10_000;
/**
 * At startup, a held lease is tried again this often until one full lifetime (plus this much) has passed. A worker that
 * was killed before it could release (a dev reload saved twice in a row) leaves a lease that simply runs out, so the
 * new one starts a little late instead of not at all; a live holder keeps renewing and still wins.
 */
export const LEASE_WAIT_RETRY_MS = 5_000;

export type AcquireOutcome = "held" | "taken" | "missing" | "error";

/** Whether an error means the lease functions are not installed (Postgres undefined_function, or PostgREST's schema-cache miss). */
export function isMissingRpc(code: string | undefined): boolean {
  return code === "42883" || code === "PGRST202";
}

/** One acquire or renew call. */
export async function acquire(db: LeaseDb, name: string, holder: string, ttlSeconds = LEASE_TTL_SECONDS, timeoutMs = LEASE_RPC_TIMEOUT_MS): Promise<AcquireOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("lease call timed out")), timeoutMs); });
    const { data, error } = await Promise.race([db.rpc("acquire_worker_lease", { p_name: name, p_holder: holder, p_ttl_seconds: ttlSeconds }), timeout]);
    if (error) return isMissingRpc(error.code) ? "missing" : "error";
    return data === true ? "held" : "taken";
  } catch {
    return "error";
  } finally {
    clearTimeout(timer);
  }
}

export interface LeaseOptions {
  db: LeaseDb;
  name: string;
  holder: string;
  log: LeaseLog;
  /** Called once when the lease is lost (another holder has it, or renewals kept failing until it would expire). */
  onLost: () => void;
  ttlSeconds?: number;
  /** How long one call may take before it counts as failed. */
  timeoutMs?: number;
  now?: () => number;
  /** Waits between startup attempts on a held lease; a test passes one that returns at once. */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class Lease {
  private lastOk = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = false;
  private lost = false;
  private warnedMissing = false;
  private readonly ttl: number;
  private readonly now: () => number;

  constructor(private readonly opts: LeaseOptions) {
    this.ttl = opts.ttlSeconds ?? LEASE_TTL_SECONDS;
    this.now = opts.now ?? Date.now;
  }

  /**
   * Takes the lease and starts renewing it. "held": the lease is ours. "taken": another worker still holds it after a
   * full lifetime of waiting (so it is alive and renewing), and the caller must exit. "unleased": the lease functions
   * are not installed yet, so the worker runs without one (warned once). A database error rejects, which also stops
   * the worker from starting.
   */
  async start(): Promise<"held" | "taken" | "unleased"> {
    const sleep = this.opts.sleep ?? realSleep;
    const until = this.now() + this.ttl * 1000 + LEASE_WAIT_RETRY_MS;
    let outcome = await acquire(this.opts.db, this.opts.name, this.opts.holder, this.ttl, this.opts.timeoutMs);
    if (outcome === "taken") this.opts.log.warn("shard lease is held, waiting for it to expire", { lease: this.opts.name, seconds: this.ttl });
    while (outcome === "taken" && this.now() < until) {
      await sleep(LEASE_WAIT_RETRY_MS);
      outcome = await acquire(this.opts.db, this.opts.name, this.opts.holder, this.ttl, this.opts.timeoutMs);
    }
    if (outcome === "missing") {
      this.warnMissing();
      return "unleased";
    }
    if (outcome === "error") throw Object.assign(new Error("acquire lease failed"), { code: "LEASE_ERROR" });
    if (outcome === "taken") return "taken";
    this.lastOk = this.now();
    this.active = true;
    this.schedule(LEASE_RENEW_MS);
    return "held";
  }

  /** One renewal attempt. Exposed for tests; the timer calls it. */
  async renew(): Promise<void> {
    if (!this.active || this.lost) return;
    const outcome = await acquire(this.opts.db, this.opts.name, this.opts.holder, this.ttl, this.opts.timeoutMs);
    if (!this.active || this.lost) return;
    if (outcome === "held") {
      this.lastOk = this.now();
      this.schedule(LEASE_RENEW_MS);
      return;
    }
    if (outcome === "taken") {
      this.lose("taken");
      return;
    }
    // A database error (or the functions vanishing): keep trying until the lease is nearly out, then stop.
    if (this.now() - this.lastOk >= this.ttl * 1000 - LEASE_SAFETY_MS) {
      this.lose("expired");
      return;
    }
    this.opts.log.warn("lease renewal failed, retrying", { lease: this.opts.name });
    this.schedule(LEASE_RETRY_MS);
  }

  /** Stops renewing and gives the lease up so the next worker can start at once. Never throws. */
  async release(): Promise<void> {
    const wasActive = this.active;
    this.active = false;
    clearTimeout(this.timer);
    if (!wasActive || this.lost) return;
    try {
      await Promise.race([
        this.opts.db.rpc("release_worker_lease", { p_name: this.opts.name, p_holder: this.opts.holder }),
        new Promise((resolve) => setTimeout(resolve, this.opts.timeoutMs ?? LEASE_RPC_TIMEOUT_MS).unref()),
      ]);
    } catch {
      // The lease expires by itself.
    }
  }

  private schedule(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.renew(), ms);
    this.timer.unref();
  }

  private lose(why: "taken" | "expired") {
    this.lost = true;
    this.active = false;
    clearTimeout(this.timer);
    this.opts.log.error("lease lost", { lease: this.opts.name, code: why === "taken" ? "LEASE_TAKEN" : "LEASE_EXPIRED" });
    this.opts.onLost();
  }

  private warnMissing() {
    if (this.warnedMissing) return;
    this.warnedMissing = true;
    this.opts.log.warn("worker leases are not installed (20261110100000_worker_leases.sql): running without a lease");
  }
}
