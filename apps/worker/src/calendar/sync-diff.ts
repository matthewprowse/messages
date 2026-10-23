import type { Json, TablesInsert } from "@messages/db";

// Which fetched events actually differ from the stored copy, so each sync writes only what changed.
// Pure, so it can be unit tested.

export type StoredEvent = {
  provider_event_id: string;
  calendar_id: string;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
  attendees: Json;
};

/** The same moment written two ways ("...+00:00" from the database, "...Z" from toISOString) is equal. */
function sameTime(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return new Date(a).getTime() === new Date(b).getTime();
}

export function eventChanged(stored: StoredEvent | undefined, next: TablesInsert<"calendar_events">): boolean {
  if (!stored) return true;
  return (
    stored.calendar_id !== next.calendar_id ||
    (stored.title ?? null) !== (next.title ?? null) ||
    !sameTime(stored.starts_at, next.starts_at) ||
    !sameTime(stored.ends_at, next.ends_at ?? null) ||
    stored.all_day !== (next.all_day ?? false) ||
    (stored.location ?? null) !== (next.location ?? null) ||
    JSON.stringify(stored.attendees ?? []) !== JSON.stringify(next.attendees ?? [])
  );
}
