// Starts many connectors without a stampede. After a deploy, a crash or a shard change every account would otherwise open
// its provider session in the same second (OAuth refresh, history catch-up, a WhatsApp socket), which trips provider rate
// limits and, for WhatsApp, looks like a ban-worthy burst from one address. Items are grouped into lanes (WhatsApp has its
// own, narrow one), each lane starts `limit` at a time with a little random delay before each start, and pauses between
// groups. A lane with no more items than its limit starts at once: one account connecting in onboarding is not slowed.

export interface StaggerOptions {
  /** Starts per group, by lane; lanes not listed use `defaultLimit`. */
  limits?: Record<string, number>;
  defaultLimit?: number;
  /** Each start in a group waits a random 0 to this many ms first. */
  jitterMs?: number;
  /** Pause between groups. */
  gapMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/** Calls `start` for every item, lane by lane in parallel; one item that throws does not stop the rest (`onError` hears of it). */
export async function startStaggered<T>(
  items: readonly T[],
  laneOf: (item: T) => string,
  start: (item: T) => void,
  onError: (item: T, err: unknown) => void,
  { limits = {}, defaultLimit = 10, jitterMs = 400, gapMs = 1_000, sleep = (ms) => new Promise<void>((r) => setTimeout(r, ms)), random = Math.random }: StaggerOptions = {},
) {
  const lanes = new Map<string, T[]>();
  for (const item of items) {
    const lane = laneOf(item);
    const list = lanes.get(lane);
    if (list) list.push(item);
    else lanes.set(lane, [item]);
  }
  await Promise.all(
    [...lanes].map(async ([lane, list]) => {
      const limit = Math.max(1, limits[lane] ?? defaultLimit);
      const spread = list.length > limit;
      for (let i = 0; i < list.length; i += limit) {
        if (i > 0) await sleep(gapMs);
        await Promise.all(
          list.slice(i, i + limit).map(async (item) => {
            if (spread && jitterMs > 0) await sleep(Math.floor(random() * jitterMs));
            try {
              start(item);
            } catch (err) {
              onError(item, err);
            }
          }),
        );
      }
    }),
  );
}
