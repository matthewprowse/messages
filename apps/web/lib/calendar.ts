// Calendar events as the Calendar page needs them. The worker copies events from Google Calendar into
// calendar_events, and row-level security returns only the signed-in user's own events.
// All-day events are stored as midnight UTC on their date, with an end date that is not included.

import { addressIndex } from "@messages/crypto/addresses";
import type { TablesInsert } from "@messages/db";
import { timeOf } from "./format";
import { buildEventRow, dateKey, timeKey, type EventField, type EventForm } from "./new-items";
import { sameRepeat } from "./recurrence";
import type { Contact as AddressBookContact } from "./types";
import { supabase } from "./supabase";
import { openEvents } from "./open-rows";
import { userKeys } from "./vault";

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
      description: e.description?.trim() || null,
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

/**
 * Events that start before `end` and are still going at `start` or start after it. With `details: false` only
 * what a grid or list needs is fetched (no guests, notes or meeting link), and loadEventDetail fills in the rest.
 */
export async function loadEvents(start: Date, end: Date, options: { details?: boolean } = {}): Promise<CalendarEvent[]> {
  const detailed = options.details !== false;
  const from = start.toISOString();
  const to = end.toISOString();
  const { data, error } = await supabase
    .from("calendar_events")
    .select(detailed ? DETAIL_COLUMNS : GRID_COLUMNS)
    .lt("starts_at", to)
    .or(`starts_at.gte.${from},ends_at.gt.${from}`)
    .order("starts_at")
    .limit(2000);
  if (error) throw new Error(`Load events failed (${error.code})`);
  return toEvents(await openEvents(data as unknown as Row[]), detailed);
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

/** An event row's second line: when, where and who, such as "09:00 to 10:00 · Office · Sarah Lee". */
export function eventDetail(e: CalendarEvent) {
  const who = e.attendees.map((a) => a.name).join(", ");
  // All Day already sits on the right, so an all-day event's line starts with where.
  const when = e.allDay ? "" : e.endsAt && e.endsAt !== e.startsAt ? `${timeOf(e.startsAt)} to ${timeOf(e.endsAt)}` : timeOf(e.startsAt);
  return [when, e.location, who].filter(Boolean).join(" · ") || "All Day";
}

// ---------------------------------------------------------------------------
// Changing an event
// ---------------------------------------------------------------------------

/** The calendars whose events can be edited and answered from here. Outlook Calendar's sign-in is read only for now. */
export function canChangeEvents(provider: string | undefined) {
  return provider === "google_calendar" || provider === "icloud_calendar";
}

/** Your answers to an invitation, as the calendar_updates table spells them. */
export type EventResponse = "accepted" | "tentative" | "declined";
export type UpdateScope = "occurrence" | "series";
export type UpdateInsert = TablesInsert<"calendar_updates">;

/** What the app shows of an event until the worker has made a change: the changed fields, laid over the event. */
export type EventPatch = Partial<Pick<CalendarEvent, "title" | "startsAt" | "endsAt" | "allDay" | "location" | "description" | "attendees" | "response" | "recurrence">>;

export function withPatch(event: CalendarEvent, patch: EventPatch | undefined): CalendarEvent {
  return patch ? { ...event, ...patch, pending: true } : event;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * An event as the dialog's form holds it, and whether its time can be edited there: the form has one date and a
 * start and end time, so an event over several days (or of no length) keeps the time it has.
 */
export function formOf(event: CalendarEvent): { form: EventForm; editableTime: boolean } {
  const base = { title: event.title, location: event.location ?? "", description: event.description ?? "", guests: event.attendees.map((a) => a.email), sendInvites: true, addMeet: false, repeat: event.recurrence ?? "" };
  if (event.allDay) {
    const days = event.endsAt ? Math.round((Date.parse(`${event.endsAt.slice(0, 10)}T00:00:00Z`) - Date.parse(`${event.startsAt.slice(0, 10)}T00:00:00Z`)) / DAY_MS) : 1;
    return { form: { ...base, date: event.startsAt.slice(0, 10), allDay: true, startTime: "09:00", endTime: "10:00" }, editableTime: days <= 1 };
  }
  const start = new Date(event.startsAt);
  const end = event.endsAt ? new Date(event.endsAt) : new Date(start.getTime() + HOUR_MS);
  const nextDay = dateKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1));
  const form = { ...base, date: dateKey(start), allDay: false, startTime: timeKey(start), endTime: timeKey(end) };
  const sameDay = dateKey(end) === form.date && end > start;
  const overnight = dateKey(end) === nextDay && form.endTime < form.startTime;
  return { form, editableTime: sameDay || overnight };
}

const sameList = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

/**
 * The calendar_updates row for the changes made in the form, with only the fields that changed, and what to show
 * meanwhile. `row` is null when nothing changed. Times are the browser's, as for a new event.
 */
export function buildUpdate(
  event: CalendarEvent,
  form: EventForm,
  scope: UpdateScope,
  timeZone: string,
  contacts: AddressBookContact[],
): { ok: true; row: UpdateInsert | null; patch: EventPatch } | { ok: false; field: EventField; error: string } {
  const initial = formOf(event);
  const accountId = event.accountId ?? "";
  // A time the form cannot show is kept as it is, so it must not be able to stop an edit of something else.
  const safe = (f: EventForm): EventForm => (initial.editableTime ? f : { ...f, allDay: false, startTime: "09:00", endTime: "10:00" });
  const next = buildEventRow(safe(form), accountId, timeZone);
  if (!next.ok) return next;
  const before = buildEventRow(safe(initial.form), accountId, timeZone);

  const row: UpdateInsert = { account_id: accountId, event_id: event.id, kind: "update", scope, send_invites: form.sendInvites };
  const patch: EventPatch = {};
  if (next.row.title !== initial.form.title.trim()) {
    row.title = next.row.title;
    patch.title = next.row.title;
  }
  if ((next.row.location ?? "") !== initial.form.location.trim()) {
    row.location = next.row.location ?? "";
    patch.location = next.row.location;
  }
  if ((next.row.description ?? "") !== initial.form.description.trim()) {
    row.description = next.row.description ?? "";
    patch.description = next.row.description;
  }
  if (initial.editableTime && (!before.ok || before.row.starts_at !== next.row.starts_at || before.row.ends_at !== next.row.ends_at || before.row.all_day !== next.row.all_day)) {
    row.starts_at = next.row.starts_at;
    row.ends_at = next.row.ends_at;
    row.all_day = next.row.all_day;
    row.time_zone = timeZone;
    patch.allDay = next.row.all_day;
    if (next.row.all_day) {
      const day = new Date(`${form.date}T00:00:00Z`);
      patch.startsAt = day.toISOString();
      patch.endsAt = new Date(day.getTime() + DAY_MS).toISOString();
    } else {
      patch.startsAt = next.row.starts_at;
      patch.endsAt = next.row.ends_at;
    }
  }
  if (!sameList(next.row.attendees, initial.form.guests.map((g) => g.toLowerCase()))) {
    row.attendees = next.row.attendees;
    patch.attendees = next.row.attendees.map((email) => {
      const known = event.attendees.find((a) => a.email === email);
      const contact = contacts.find((c) => c.emails.some((e) => e.toLowerCase() === email));
      return known ?? { email, name: contact?.name ?? email, contactId: contact?.id ?? null };
    });
  }
  // A new rule, never none: a series cannot be made a single event from here, and "" leaves a single event as it is.
  if (form.repeat && !sameRepeat(form.repeat, initial.form.repeat ?? "", new Date(event.startsAt))) {
    row.recurrence = form.repeat;
    patch.recurrence = form.repeat;
  }
  const changed = row.title !== undefined || row.location !== undefined || row.description !== undefined || row.starts_at !== undefined || row.attendees !== undefined || row.recurrence !== undefined;
  return { ok: true, row: changed ? row : null, patch };
}

/** The calendar_updates row that answers an invitation. */
export function buildResponse(event: CalendarEvent, response: EventResponse): UpdateInsert {
  return { account_id: event.accountId ?? "", event_id: event.id, kind: "rsvp", scope: "occurrence", response };
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
