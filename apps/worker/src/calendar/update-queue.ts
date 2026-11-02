// The calendar_updates table: the app adds queued changes, the worker claims, makes and settles them.

import type { TablesUpdate } from "@messages/db";
import { db, must, retryWrite } from "../db";
import { errorCode, log } from "../log";
import type { StoredCalendarEvent } from "./delete-event";
import { openEvent, sealEvent } from "./sealed";
import { exactTimes, shiftedTimes, storedPatch, type CalendarUpdateRow, type Change, type SeriesShift } from "./update-event";

export const INTERRUPTED = "Changing this event was interrupted. Reload to check whether it changed.";
export const NOT_RECORDED = "The event was changed, but that could not be recorded. Reload to check.";


/** Marks a queued update as under way. Returns false if another run already took it. */
export async function claimUpdate(id: string): Promise<boolean> {
  const rows = must(await db.from("calendar_updates").update({ status: "updating" }).eq("id", id).eq("status", "queued").select("id"), "claim calendar update");
  return rows.length === 1;
}

/** Marks an update as failed with a reason shown to the user. Does nothing if it already finished. */
export async function failUpdate(id: string, reason: string) {
  must(
    await db.from("calendar_updates").update({ status: "failed", error: reason, done_at: new Date().toISOString() }).eq("id", id).in("status", ["queued", "updating"]),
    "fail calendar update",
  );
}

/** The stored event an update is for, or null once it is gone. */
export async function storedEventOfUpdate(row: CalendarUpdateRow): Promise<StoredCalendarEvent | null> {
  if (!row.event_id) return null;
  const stored = must(await db.from("calendar_events").select("*").eq("id", row.event_id).eq("account_id", row.account_id).maybeSingle(), "load event to change");
  return stored ? await openEvent(stored.user_id, stored) : null;
}

/** Settles a change the calendar has taken. `note` says what was not done, for a change applied only in part. */
export async function settleUpdated(id: string, note: string | null = null) {
  const saved = await retryWrite(() =>
    db.from("calendar_updates").update({ status: "done", error: note, done_at: new Date().toISOString() }).eq("id", id).eq("status", "updating"),
  );
  if (!saved) await failUpdate(id, NOT_RECORDED).catch(() => undefined);
}

/** The oldest queued changes, of the given accounts when asked (a worker reads only the accounts it runs). */
export async function queuedUpdates(accountIds?: string[]): Promise<CalendarUpdateRow[]> {
  if (accountIds && accountIds.length === 0) return [];
  const query = db.from("calendar_updates").select("*").eq("status", "queued");
  return must(await (accountIds ? query.in("account_id", accountIds) : query).order("created_at").limit(50), "load calendar updates");
}

/** An update left "updating" by a worker that stopped mid-request may or may not have happened, so it is failed rather than sent again. */
export async function failInterruptedUpdates() {
  must(
    await db.from("calendar_updates").update({ status: "failed", error: INTERRUPTED, done_at: new Date().toISOString() }).eq("status", "updating"),
    "fail interrupted updates",
  );
}

/** Writes the change to the stored copy, so the app shows it before the next sync. A failed write is left to the sync. */
export async function saveStored(userId: string, ids: { id: string; patch: TablesUpdate<"calendar_events"> }[]) {
  for (const { id, patch } of ids) {
    const saved = await db.from("calendar_events").update(await sealEvent(userId, patch)).eq("id", id);
    if (saved.error) log.warn("changed event not stored", { code: saved.error.code });
  }
}


/**
 * Writes a change that has been made in the calendar to the stored copy: to the one event, or for a change to the
 * whole series to every stored occurrence of it (their times move with `shift`; the one asked about gets exactly the
 * new time). The app shows the change at once; a failed write is left to the next sync.
 */
export async function storeChange(event: StoredCalendarEvent, change: Change, series: boolean, shift: SeriesShift | null) {
  try {
    const rows = series && event.series_id
      ? must(await db.from("calendar_events").select("*").eq("account_id", event.account_id).eq("series_id", event.series_id), "load series to change")
      : [event];
    await saveStored(
      event.user_id,
      rows.map((r) => ({
        id: r.id,
        patch: storedPatch(r, change, !change.time ? null : r.id === event.id ? exactTimes(change.time) : shift ? shiftedTimes(r, shift) : null),
      })),
    );
  } catch (err) {
    log.warn("changed event not stored", { code: errorCode(err) });
  }
}
