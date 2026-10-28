// How a Realtime reconnect catches up: nothing after a blip, only what changed after a short drop, everything after a long one.

/** A drop shorter than this loses nothing worth fetching for. */
export const SKIP_UNDER_MS = 30_000;
/** A drop longer than this reloads everything, as a deletion in the gap would not be seen otherwise. */
export const FULL_OVER_MS = 15 * 60_000;
/** Server and browser clocks differ a little, so a catch-up reaches this far back before the drop. */
export const CLOCK_MARGIN_MS = 60_000;

export type ResyncPlan = "skip" | "delta" | "full";

export function resyncPlan(downMs: number): ResyncPlan {
  if (downMs < SKIP_UNDER_MS) return "skip";
  return downMs > FULL_OVER_MS ? "full" : "delta";
}

/** The time a catch-up asks the server for changes after, as an ISO string. */
export function changesSince(lastAliveMs: number): string {
  return new Date(lastAliveMs - CLOCK_MARGIN_MS).toISOString();
}
