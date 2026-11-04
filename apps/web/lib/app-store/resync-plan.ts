// How the store catches up on what it missed: nothing after a blip, only what changed after a short gap, everything
// after a long one. And the clock that finds those gaps (a dropped socket, a computer that slept, a phone that froze
// the page in the background) so that each is caught up once. Pure: use-realtime.ts feeds it times and events.

/** A drop shorter than this loses nothing worth fetching for. */
export const SKIP_UNDER_MS = 30_000;
/** A drop longer than this reloads everything, as a deletion in the gap would not be seen otherwise. */
export const FULL_OVER_MS = 15 * 60_000;
/** Server and browser clocks differ a little, so a catch-up reaches this far back before the drop. */
export const CLOCK_MARGIN_MS = 60_000;
/**
 * No alive tick for this long means the page was asleep or frozen. Ticks come every 10 s, and a hidden desktop tab
 * still ticks about once a minute, so this tells sleep from throttling.
 */
export const ASLEEP_OVER_MS = 120_000;
/** After a failed catch-up, the alive tick tries again no sooner than this. A rejoin or the page coming back tries at once. */
export const RETRY_AFTER_MS = 30_000;

export type ResyncPlan = "skip" | "delta" | "full";

export function resyncPlan(downMs: number): ResyncPlan {
  if (downMs < SKIP_UNDER_MS) return "skip";
  return downMs > FULL_OVER_MS ? "full" : "delta";
}

/** The time a catch-up asks the server for changes after, as an ISO string. */
export function changesSince(lastAliveMs: number): string {
  return new Date(lastAliveMs - CLOCK_MARGIN_MS).toISOString();
}

/** A gap to catch up on. `from` is when the store was last known current, which a failed catch-up hands back. */
export interface Gap {
  plan: "delta" | "full";
  downMs: number;
  since: string;
  from: number;
}

/** What the realtime hook asks: each call returns the gap to catch up on now, or null when there is none. */
export interface CatchUpClock {
  /** The alive tick, every 10 s while the page runs. A late one means it slept, and the socket may not have noticed. */
  tick(now: number): Gap | null;
  /** The page is visible again, came back from the back/forward cache, or the device is back online. */
  resumed(now: number): Gap | null;
  /** The socket went down (CHANNEL_ERROR, TIMED_OUT or CLOSED). Nothing arrives until it rejoins. */
  dropped(): void;
  /** The socket joined. After a drop, the gap since the store was last current. */
  subscribed(now: number): Gap | null;
  /** The catch-up for this gap failed: the gap is owed again, so the next tick, rejoin or return tries it. */
  failed(gap: Gap, now: number): void;
}

/**
 * Every path that can find a gap asks this clock, and the first to ask claims it: claiming moves `aliveAt` to now, so
 * the path that asks next (a late tick after the page came back, the socket rejoining a moment later) finds nothing
 * left and no gap is caught up twice. What happens after the claim, if the socket was in fact down, is a new gap the
 * rejoin covers.
 */
export function createCatchUpClock(start: number): CatchUpClock {
  let aliveAt = start; // when the store was last known current
  let lastTick = start;
  let down = false;
  let owed = false;
  let retryAt = 0;

  function claim(now: number): Gap | null {
    const downMs = now - aliveAt;
    const plan = resyncPlan(downMs);
    if (plan === "skip") return null; // aliveAt stays, so the gap still counts if it grows
    const gap: Gap = { plan, downMs, since: changesSince(aliveAt), from: aliveAt };
    aliveAt = now;
    lastTick = now; // the overdue tick that often follows a return must not read as a second wake
    owed = false;
    return gap;
  }

  return {
    tick(now) {
      const late = now - lastTick > ASLEEP_OVER_MS;
      lastTick = now;
      if (down) return null; // the rejoin catches up
      if (late || (owed && now >= retryAt)) return claim(now);
      if (!owed) aliveAt = now;
      return null;
    },
    resumed: claim,
    dropped() {
      down = true;
    },
    subscribed(now) {
      const wasDown = down;
      down = false;
      const gap = wasDown ? claim(now) : null;
      // A blip shorter than SKIP_UNDER_MS is let go: the socket is back and nothing worth a fetch was missed.
      if (!gap && !owed) aliveAt = now;
      return gap;
    },
    failed(gap, now) {
      aliveAt = Math.min(aliveAt, gap.from);
      owed = true;
      retryAt = now + RETRY_AFTER_MS;
    },
  };
}
