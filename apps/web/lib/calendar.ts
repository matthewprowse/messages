import { addressIndex } from "@messages/crypto/addresses";
import { supabase } from "./supabase";
import { userKeys } from "./vault";

// Calendar events as the Calendar page needs them. The worker copies events from Google Calendar into
// calendar_events, and row-level security returns only the signed-in user's own events.
// All-day events are stored as midnight UTC on their date, with an end date that is not included.

export interface EventAttendee {
  name: string;
  email: string;
  /** The contact with this address, when there is one. */
  contactId: string | null;
}

export interface CalendarEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  /** Everyone invited except you. */
  attendees: EventAttendee[];
}

type StoredAttendee = { email?: string; name?: string | null; self?: boolean };

function attendeesOf(raw: unknown): StoredAttendee[] {
  return Array.isArray(raw) ? raw.filter((a): a is StoredAttendee => !!a && typeof a === "object" && typeof (a as StoredAttendee).email === "string") : [];
}

/** Events that start before `end` and are still going at `start` or start after it. */
export async function loadEvents(start: Date, end: Date): Promise<CalendarEvent[]> {
  const from = start.toISOString();
  const to = end.toISOString();
  const { data, error } = await supabase
    .from("calendar_events")
    .select("id, title, starts_at, ends_at, all_day, location, attendees")
    .lt("starts_at", to)
    .or(`starts_at.gte.${from},ends_at.gt.${from}`)
    .order("starts_at")
    .limit(2000);
  if (error) throw new Error(`Load events failed (${error.code})`);

  const emails = [...new Set(data.flatMap((e) => attendeesOf(e.attendees).filter((a) => !a.self).map((a) => a.email!.toLowerCase())))];
  // People are found by their address's index, which is what the database matches on.
  const keys = emails.length ? await userKeys() : null;
  const byIndex = new Map(await Promise.all(emails.map(async (email) => [await addressIndex(keys!, email), email] as const)));
  const indexes = [...byIndex.keys()];
  const contacts = new Map<string, { id: string; name: string }>();
  for (let i = 0; i < indexes.length; i += 200) {
    const { data: ids, error: idError } = await supabase
      .from("contact_identities")
      .select("value_index, contacts(id, display_name)")
      .eq("kind", "email")
      .in("value_index", indexes.slice(i, i + 200));
    if (idError) throw new Error(`Load attendees failed (${idError.code})`);
    for (const row of ids) {
      const email = row.value_index ? byIndex.get(row.value_index) : undefined;
      if (row.contacts && email) contacts.set(email, { id: row.contacts.id, name: row.contacts.display_name });
    }
  }

  return data.map((e) => ({
    id: e.id,
    title: e.title?.trim() || "No Title",
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    allDay: e.all_day,
    location: e.location?.trim() || null,
    attendees: attendeesOf(e.attendees)
      .filter((a) => !a.self)
      .map((a) => {
        const email = a.email!.toLowerCase();
        const contact = contacts.get(email);
        return { email, name: a.name?.trim() || contact?.name || email, contactId: contact?.id ?? null };
      }),
  }));
}

/** A local calendar day as "YYYY-MM-DD". */
export function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The local days an event appears on, within the given days. Timed events show on every day they run,
 * so one that started before the first day shown still appears; ending at midnight does not count that day.
 */
export function daysOf(event: CalendarEvent, days: string[]): string[] {
  if (!event.allDay) {
    const start = new Date(event.startsAt);
    const first = dayKey(start);
    const end = event.endsAt ? new Date(event.endsAt) : null;
    const last = end && end > start ? dayKey(new Date(end.getTime() - 1)) : first;
    return days.filter((d) => d >= first && d <= last);
  }
  // All-day dates are calendar dates, so they are compared as written rather than in local time.
  const first = event.startsAt.slice(0, 10);
  const last = event.endsAt ? event.endsAt.slice(0, 10) : null;
  return days.filter((d) => d >= first && (last && last > first ? d < last : d === first));
}
