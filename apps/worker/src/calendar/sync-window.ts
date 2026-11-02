// How far around today each calendar connector keeps events. The Calendar page lets people browse any month, so the
// window is wide (90 days back, 365 ahead): beyond it the page says "Not Synced" (apps/web/lib/sync-window.ts keeps
// the same two numbers and must change with them). Rows that fall out of the back of the window are never deleted
// (storeWindow only removes events that start inside the window it was given), so history grows rather than shrinks.
// Pure, so the dates are unit tested.

export const PAST_DAYS = 90;
export const FUTURE_DAYS = 365;
/** The part of the window that changes often, polled on its own by connectors with no cheap change check. */
export const NEAR_PAST_DAYS = 7;
export const NEAR_FUTURE_DAYS = 60;
/** The whole window is fetched at least this often, even when only the near part is polled. */
export const FULL_EVERY_MS = 60 * 60_000;

const DAY_MS = 86_400_000;

export type SyncWindow = { timeMin: string; timeMax: string };

/** The window around `now` (ms): the whole of it, or only the near part that changes often. */
export function syncWindow(now: number, part: "full" | "near" = "full"): SyncWindow {
  const past = part === "full" ? PAST_DAYS : NEAR_PAST_DAYS;
  const future = part === "full" ? FUTURE_DAYS : NEAR_FUTURE_DAYS;
  return { timeMin: new Date(now - past * DAY_MS).toISOString(), timeMax: new Date(now + future * DAY_MS).toISOString() };
}

/** True when the whole window is due: never fetched yet, or not for FULL_EVERY_MS. */
export function fullFetchDue(now: number, lastFullAt: number | null): boolean {
  return lastFullAt === null || now - lastFullAt >= FULL_EVERY_MS;
}
