// Deleting an event from the app: calendar_deletes rows are queued by the app, claimed here, carried out by
// the account's connector, and settled once the stored copy is gone too.

import type { Tables } from "@messages/db";
import { db, must, retryWrite } from "../db";
import { readQueued } from "../in-chunks";
import { errorCode, log } from "../log";

export type CalendarDeleteRow = Tables<"calendar_deletes">;
export type StoredCalendarEvent = Tables<"calendar_events">;

export const DELETE_NOT_GRANTED = "Reconnect Google in Settings, Connected Accounts, to allow changing events.";
export const GONE = "This event no longer exists.";

/** Marks a queued delete as under way. Returns false if another run already took it. */
export async function claimDelete(id: string): Promise<boolean> {
  const rows = must(await db.from("calendar_deletes").update({ status: "deleting" }).eq("id", id).eq("status", "queued").select("id"), "claim calendar delete");
  return rows.length === 1;
}

/** Marks a delete as failed with a reason shown to the user. Does nothing if it already finished. */
export async function failDelete(id: string, reason: string) {
  must(
    await db.from("calendar_deletes").update({ status: "failed", error: reason, done_at: new Date().toISOString() }).eq("id", id).in("status", ["queued", "deleting"]),
    "fail calendar delete",
  );
}

/** The stored event a delete is for, or null once it is gone. */
export async function storedEventOf(row: CalendarDeleteRow): Promise<StoredCalendarEvent | null> {
  if (!row.event_id) return null;
  return must(await db.from("calendar_events").select("*").eq("id", row.event_id).eq("account_id", row.account_id).maybeSingle(), "load event to delete");
}

/**
 * The event is gone from its calendar: removes the stored copy (the whole series when that is what was asked
 * for), so the app stops showing it before the next sync, and settles the row.
 */
export async function settleDeleted(row: CalendarDeleteRow, event: StoredCalendarEvent) {
  const wholeSeries = row.scope === "series" && event.series_id;
  // The event is already gone from its calendar. A failed local removal must not leave the row "deleting": the next sync removes the copy.
  try {
    must(
      await (wholeSeries
        ? db.from("calendar_events").delete().eq("account_id", row.account_id).eq("series_id", event.series_id!)
        : db.from("calendar_events").delete().eq("id", event.id)),
      "remove deleted event",
    );
  } catch (err) {
    log.warn("deleted event not removed from the app", { code: errorCode(err) });
  }
  const saved = await retryWrite(() => db.from("calendar_deletes").update({ status: "done", error: null, done_at: new Date().toISOString() }).eq("id", row.id).eq("status", "deleting"));
  if (!saved) await failDelete(row.id, "The event was deleted, but that could not be recorded. Reload to check.").catch(() => undefined);
}

/** The oldest queued deletes, of the given accounts when asked (a worker reads only the accounts it runs). */
export async function queuedDeletes(accountIds?: string[]): Promise<CalendarDeleteRow[]> {
  if (accountIds && accountIds.length === 0) return [];
  const query = () => db.from("calendar_deletes").select("*").eq("status", "queued");
  if (!accountIds) return must(await query().order("created_at").limit(50), "load calendar deletes");
  return readQueued(accountIds, (slice) => query().in("account_id", slice).order("created_at").limit(50), "load calendar deletes", 50);
}

/** A delete left "deleting" by a worker that stopped mid-request may or may not have happened, so it is failed rather than sent again. */
export async function failInterruptedDeletes() {
  must(
    await db
      .from("calendar_deletes")
      .update({ status: "failed", error: "Deleting this event was interrupted. Reload to check whether it is gone.", done_at: new Date().toISOString() })
      .eq("status", "deleting"),
    "fail interrupted deletes",
  );
}
