// Calendar events as the Calendar page needs them: the CalendarEvent type, loading events and following a queued
// change. The worker copies events from the calendars into calendar_events, and row-level security returns only the
// signed-in user's own events. All-day events are stored as midnight UTC on their date, with an end date that is not
// included. The day maths is in calendar-days.ts and building changes in calendar-edit.ts; both are re-exported here
// because the Summary imports them from this module.

import { addressIndex } from "@messages/crypto/addresses";
import { supabase } from "./supabase";
import { openEvents } from "./open-rows";
import { eventNotes } from "@messages/email-text/event-notes";
import { userKeys } from "./vault";

export { dayKey } from "./dates";
export { daysOf, eventDetail } from "./calendar-days";
export * from "./calendar-edit";

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
  /** The calendar account it is in, which says where it can be deleted. */
  accountId?: string;
  /** The event's notes. */
  description?: string | null;
  /** Which calendar it is on, such as "Home". */
  calendarName?: string | null;
  /** A Zoom, Meet or Teams link (https only). */
  conferenceUrl?: string | null;
  /** Set when it is one occurrence of a repeating event; every occurrence shares it. */
  seriesId?: string | null;
  /** How its series repeats, as an iCalendar rule (lib/recurrence.ts). Loaded with the details. */
  recurrence?: string | null;
  /** Who invited you, when it is not you. */
  organizer?: { name: string; email: string } | null;
  /** Your answer to the invitation: accepted, tentative, declined or needsAction. Null when you were not invited. */
  response?: string | null;
  /** False when only what a grid needs was loaded: no guests, notes or meeting link yet. */
  detailed?: boolean;
  /** Saved here and not yet created in the calendar. */
  pending?: boolean;
  /** The calendar's own ids, which make the link to the event. */
  providerEventId?: string;
  calendarId?: string;
}

type StoredAttendee = { email?: string; name?: string | null; self?: boolean; organizer?: boolean; response?: string | null };

function attendeesOf(raw: unknown): StoredAttendee[] {
  return Array.isArray(raw) ? raw.filter((a): a is StoredAttendee => !!a && typeof a === "object" && typeof (a as StoredAttendee).email === "string") : [];
}

// What the grid and lists need to draw an event. The notes, guests and meeting link are fetched when an event is opened.
const GRID_COLUMNS = "id, account_id, title, starts_at, ends_at, all_day, location, calendar_name, series_id";
const DETAIL_COLUMNS = `${GRID_COLUMNS}, attendees, description, conference_url, provider_event_id, calendar_id, recurrence`;
const CONTACT_TTL = 5 * 60_000;

type Contact = { id: string; name: string } | null;
interface AddressCache {
  /** Each email's address index, which never changes for one user's keys. */
  index: Map<string, string>;
  /** What the index found, kept for a few minutes so moving between weeks does not look every guest up again. */
  contacts: Map<string, { at: number; contact: Contact }>;
}
// One cache per set of keys, so signing in as someone else starts empty.
const caches = new WeakMap<object, AddressCache>();

/** The contacts for these addresses, looking up only the ones not seen recently. */
async function contactsFor(emails: string[]): Promise<Map<string, Contact>> {
  const found = new Map<string, Contact>();
  if (emails.length === 0) return found;
  const keys = await userKeys();
  let cache = caches.get(keys);
  if (!cache) {
    cache = { index: new Map(), contacts: new Map() };
    caches.set(keys, cache);
  }
  const now = Date.now();
  const stale: string[] = [];
  for (const email of emails) {
    const hit = cache.contacts.get(email);
    if (hit && now - hit.at < CONTACT_TTL) found.set(email, hit.contact);
    else stale.push(email);
  }
  if (stale.length === 0) return found;

  // People are found by their address's index, which is what the database matches on.
  const byIndex = new Map<string, string>();
  for (const email of stale) {
    let index = cache.index.get(email);
    if (!index) {
      index = await addressIndex(keys, email);
      cache.index.set(email, index);
    }
    byIndex.set(index, email);
  }
  const indexes = [...byIndex.keys()];
  // The lookups go in batches of 200, all at once rather than one after another.
  const batches = Array.from({ length: Math.ceil(indexes.length / 200) }, (_, i) => indexes.slice(i * 200, i * 200 + 200));
  const results = await Promise.all(
    batches.map((batch) => supabase.from("contact_identities").select("value_index, contacts(id, display_name)").eq("kind", "email").in("value_index", batch)),
  );
  const matched = new Map<string, Contact>();
  for (const { data: ids, error: idError } of results) {
    if (idError) throw new Error(`Load attendees failed (${idError.code})`);
    for (const row of ids) {
      const email = row.value_index ? byIndex.get(row.value_index) : undefined;
      if (row.contacts && email) matched.set(email, { id: row.contacts.id, name: row.contacts.display_name });
    }
  }
  for (const email of stale) {
    const contact = matched.get(email) ?? null;
    cache.contacts.set(email, { at: now, contact });
    found.set(email, contact);
  }
  return found;
}

type Row = {
  id: string;
  account_id: string;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
  calendar_name: string | null;
  series_id: string | null;
  attendees?: unknown;
  description?: string | null;
  conference_url?: string | null;
  provider_event_id?: string;
  calendar_id?: string;
  recurrence?: string | null;
};

async function toEvents(data: Row[], detailed: boolean): Promise<CalendarEvent[]> {
  const emails = detailed ? [...new Set(data.flatMap((e) => attendeesOf(e.attendees).filter((a) => !a.self).map((a) => a.email!.toLowerCase())))] : [];
  const contacts = await contactsFor(emails);

  return data.map((e) => {
    const base: CalendarEvent = {
      id: e.id,
      accountId: e.account_id,
      title: e.title?.trim() || "No Title",
      startsAt: e.starts_at,
      endsAt: e.ends_at,
      allDay: e.all_day,
      location: e.location?.trim() || null,
      calendarName: e.calendar_name?.trim() || null,
      seriesId: e.series_id,
      attendees: [],
      detailed,
    };
    if (!detailed) return base;
    const all = attendeesOf(e.attendees);
    const nameOf = (a: StoredAttendee) => {
      const email = a.email!.toLowerCase();
      return a.name?.trim() || contacts.get(email)?.name || email;
    };
    const organizer = all.find((a) => a.organizer && !a.self);
    return {
      ...base,
      // Notes stored as Google sent them (HTML) before the worker kept text are turned into text here, never rendered as markup.
      description: eventNotes(e.description),
      // The worker keeps only https links, and so does the app, as the link becomes a button.
      conferenceUrl: e.conference_url && /^https:\/\//i.test(e.conference_url) ? e.conference_url : null,
      providerEventId: e.provider_event_id,
      calendarId: e.calendar_id,
      recurrence: e.recurrence ?? null,
      organizer: organizer ? { name: nameOf(organizer), email: organizer.email!.toLowerCase() } : null,
      response: all.find((a) => a.self)?.response ?? null,
      attendees: all
        .filter((a) => !a.self)
        .map((a) => {
          const email = a.email!.toLowerCase();
          return { email, name: nameOf(a), contactId: contacts.get(email)?.id ?? null };
        }),
    };
  });
}

const PAGE = 1000; // rows one request returns
const MAX_PAGES = 5; // a year of a very busy diary; beyond it the latest days are cut, as before but ten times later
const DAY_MS = 86_400_000;

/**
 * Events that start before `end` and are still going at `start` or start after it. With `details: false` only
 * what a grid or list needs is fetched (no guests, notes or meeting link), and loadEventDetail fills in the rest.
 * The query reaches a day either side: all-day events are stored at midnight UTC, which for anyone west of UTC falls
 * a day off the local midnights, and daysOf drops the extras. It is read in pages so a long agenda is not cut at 1,000.
 */
export async function loadEvents(start: Date, end: Date, options: { details?: boolean } = {}): Promise<CalendarEvent[]> {
  const detailed = options.details !== false;
  const from = new Date(start.getTime() - DAY_MS).toISOString();
  const to = new Date(end.getTime() + DAY_MS).toISOString();
  const rows: Row[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from("calendar_events")
      .select(detailed ? DETAIL_COLUMNS : GRID_COLUMNS)
      .lt("starts_at", to)
      .or(`starts_at.gte.${from},ends_at.gt.${from}`)
      .order("starts_at")
      .order("id")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`Load events failed (${error.code})`);
    rows.push(...(data as unknown as Row[]));
    if (data.length < PAGE) break;
  }
  return toEvents(await openEvents(rows), detailed);
}

/** One event with everything about it, or null when it is not there (any more). */
export async function loadEventDetail(id: string): Promise<CalendarEvent | null> {
  const { data, error } = await supabase.from("calendar_events").select(DETAIL_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`Load event failed (${error.code})`);
  if (!data) return null;
  return (await toEvents(await openEvents([data as unknown as Row]), true))[0];
}

/** The link to a Google Calendar event in Google Calendar, or null when it cannot be worked out. Always https. */
export function googleEventUrl(e: Pick<CalendarEvent, "providerEventId" | "calendarId">): string | null {
  if (!e.providerEventId || !e.calendarId) return null;
  try {
    const eid = btoa(`${e.providerEventId} ${e.calendarId}`).replace(/=+$/, "");
    const url = `https://www.google.com/calendar/event?eid=${encodeURIComponent(eid)}`;
    return /^https:\/\//i.test(url) ? url : null;
  } catch {
    return null;
  }
}

export interface UpdateResult {
  status: string;
  error: string | null;
}

/** Not a failure: the worker may still finish, so callers say it is still being made rather than invite a retry. */
export const GAVE_UP = "unknown";
const UPDATE_GIVE_UP: UpdateResult = { status: GAVE_UP, error: null };

/**
 * Waits for the worker to settle a queued change, by the row's Realtime updates with a poll as a safety net.
 * Resolves with the row at that point (done, or failed with the reason), or with status GAVE_UP after giveUpMs. A done
 * row's error, when it has one, is a note about what was not done.
 */
export function followUpdate(id: string, { giveUpMs = 60_000, pollMs = 1500 }: { giveUpMs?: number; pollMs?: number } = {}): Promise<UpdateResult> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (row: UpdateResult) => {
      if (finished) return;
      finished = true;
      clearInterval(poll);
      clearTimeout(giveUp);
      void supabase.removeChannel(channel);
      resolve(row);
    };
    const apply = (row: UpdateResult | null) => {
      if (row && (row.status === "done" || row.status === "failed")) finish(row);
    };
    const channel = supabase
      .channel(`calendar_updates-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "calendar_updates", filter: `id=eq.${id}` }, (payload) => apply(payload.new as UpdateResult))
      .subscribe();
    const poll = setInterval(() => void supabase.from("calendar_updates").select("status, error").eq("id", id).maybeSingle().then(({ data }) => apply(data)), pollMs);
    const giveUp = setTimeout(() => finish(UPDATE_GIVE_UP), giveUpMs);
  });
}
