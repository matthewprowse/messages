// Which sync worker owns which account. With one worker (the default: WORKER_SHARD_COUNT=1) it owns them all and
// nothing changes. With several, each account belongs to exactly one shard, chosen by a stable hash of its id, so no
// account is ever synced twice. Pure logic with no database or env import, so it is testable on its own.
//
// The hash is the first 8 hex digits of the account's uuid read as a number, modulo the shard count. Account ids are
// random (v4), so the split is even. CHANGING WORKER_SHARD_COUNT REASSIGNS ACCOUNTS: most of them move to another shard.
// That is safe: each worker's reconcile (every 30 s) stops connectors it no longer owns and starts the ones it now owns,
// so a moved account restarts once on its new shard. Change the count on every worker at about the same time; for a
// minute or two an account may run on both, which a connector already tolerates (its writes are idempotent upserts).

export interface ShardConfig {
  index: number;
  count: number;
}

/** Reads WORKER_SHARD_INDEX and WORKER_SHARD_COUNT. `error` is set (and the config falls back to 0 of 1) when they are invalid. */
export function parseShard(source: Record<string, string | undefined>): ShardConfig & { error?: string } {
  const rawIndex = source.WORKER_SHARD_INDEX?.trim();
  const rawCount = source.WORKER_SHARD_COUNT?.trim();
  const index = rawIndex ? Number(rawIndex) : 0;
  const count = rawCount ? Number(rawCount) : 1;
  if (!Number.isInteger(count) || count < 1) return { index: 0, count: 1, error: "WORKER_SHARD_COUNT must be a whole number of at least 1." };
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    return { index: 0, count: 1, error: `WORKER_SHARD_INDEX must be a whole number from 0 to ${count - 1} (WORKER_SHARD_COUNT is ${count}).` };
  }
  return { index, count };
}

/** The shard an account belongs to, 0 to count - 1. Stable for a given id and count. */
export function shardOf(accountId: string, count: number): number {
  if (count <= 1) return 0;
  const n = Number.parseInt(accountId.replace(/-/g, "").slice(0, 8), 16);
  // Not a uuid: hash the text instead so every id still lands on exactly one shard.
  if (Number.isNaN(n)) return fallbackHash(accountId) % count;
  return n % count;
}

function fallbackHash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** Whether the shard `config` owns the account. */
export function owns(config: ShardConfig, accountId: string): boolean {
  return shardOf(accountId, config.count) === config.index;
}

const current = parseShard(process.env);

/** Why the shard settings are unusable, or undefined. env.ts stops the worker with it. */
export const shardError = current.error;
export const shardIndex = current.index;
export const shardCount = current.count;

/** Whether this worker syncs the account. Always true with one worker. */
export function ownsAccount(accountId: string): boolean {
  return owns(current, accountId);
}

/** Shard 0 runs the jobs that must run once (see the README, "Running more than one worker"). Always true with one worker. */
export const isPrimaryShard = current.index === 0;
