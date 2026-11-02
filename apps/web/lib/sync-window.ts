// What the Calendar page knows about how far the sync worker has read each calendar, so a month it never fetched says
// "Not Synced" instead of showing an empty diary that looks free. The two numbers mirror apps/worker/src/calendar/
// sync-window.ts (PAST_DAYS, FUTURE_DAYS) and must change together. Pure.

import { addDays, dayKey, startOfDay } from "./dates";

/** Days back and ahead of today that the worker keeps in step with the calendars. */
export const SYNC_PAST_DAYS = 90;
export const SYNC_FUTURE_DAYS = 365;

export type SyncNotice = { kind: "future" | "past"; title: string; text: string } | null;

/**
 * Whether the days on screen (`firstKey` to `lastKey`, inclusive) reach outside what is synced. The future edge is
 * firm: nothing past a year ahead has been read. The past edge is soft, since events stored while the window was
 * newer stay, so it only warns when nothing at all was found there (`found`).
 */
export function syncNotice(firstKey: string, lastKey: string, today: Date, found: boolean): SyncNotice {
  const latest = dayKey(addDays(startOfDay(today), SYNC_FUTURE_DAYS));
  const earliest = dayKey(addDays(startOfDay(today), -SYNC_PAST_DAYS));
  if (firstKey > latest) return { kind: "future", title: "Not Synced", text: "Your calendars are read up to a year ahead, so nothing is shown this far on." };
  if (lastKey > latest) return { kind: "future", title: "Partly Not Synced", text: "Your calendars are read up to a year ahead, so the last days of this range may be missing events." };
  if (lastKey < earliest && !found) return { kind: "past", title: "Not Synced", text: "Events from before the last three months were not read, so none can be shown here." };
  return null;
}
