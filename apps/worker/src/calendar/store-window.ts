// Replaces the stored copy of one account's events in a window with what the calendar has now. Shared by
// Google Calendar and Outlook Calendar, which both fetch the whole window each time.

import type { TablesInsert } from "@messages/db";
import { allRows, db, must } from "../db";
import { chunks } from "../util";
import { openEvent, sealEvent } from "./sealed";
import { eventChanged, type StoredEvent } from "./sync-diff";

/**
 * Writes new and changed events, and removes stored events in the window that the calendar no longer
 * has (cancelled, moved out or hidden). Returns how many were written and removed.
 */
export async function storeWindow(
  accountId: string,
  rows: Map<string, TablesInsert<"calendar_events">>,
  window: { timeMin: string; timeMax: string },
): Promise<{ written: number; removed: number }> {
  // The stored copy, every page of it: a window can hold more than the 1,000 rows one request returns.
  const sealedStored: (StoredEvent & { id: string; user_id: string })[] = await allRows(
    (from, to) =>
      db
        .from("calendar_events")
        .select("id, user_id, provider_event_id, calendar_id, title, starts_at, ends_at, all_day, location, attendees, description, calendar_name, conference_url, resource_url, series_id, recurrence")
        .eq("account_id", accountId)
        .order("id")
        .range(from, to),
    "load stored events",
  );
  // Titles and locations are stored encrypted, so they are opened to compare with what the calendar has now.
  const stored = await Promise.all(sealedStored.map((e) => openEvent(e.user_id, e)));
  const byEventId = new Map(stored.map((e) => [e.provider_event_id, e]));

  // Only new or changed events are written, so an unchanged calendar costs no writes.
  const changed = [...rows.values()].filter((row) => eventChanged(byEventId.get(row.provider_event_id), row));
  for (const batch of chunks(changed, 500)) {
    const sealed = await Promise.all(batch.map((row) => sealEvent(row.user_id, row)));
    must(await db.from("calendar_events").upsert(sealed, { onConflict: "account_id,provider_event_id" }), "save calendar events");
  }

  const min = Date.parse(window.timeMin);
  const max = Date.parse(window.timeMax);
  const stale = stored
    .filter((e) => !rows.has(e.provider_event_id))
    .filter((e) => {
      const t = Date.parse(e.starts_at);
      return t >= min && t < max;
    })
    .map((e) => e.id);
  for (const batch of chunks(stale, 200)) must(await db.from("calendar_events").delete().in("id", batch), "remove stale events");
  return { written: changed.length, removed: stale.length };
}
