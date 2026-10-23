import type { Json, Tables, TablesInsert } from "@messages/db";
import { isEmailAddress } from "../send/from-address";

// Turns a queued calendar_outbox row into the request that creates it in Google Calendar, and the
// created event into a calendar_events row. Pure functions only, so all of it is unit tested.

export const API = "https://www.googleapis.com/calendar/v3";
export const MAX_ATTENDEES = 50;

export type CalendarOutboxRow = Tables<"calendar_outbox">;

export const EVENTS_NOT_GRANTED = "Reconnect Google to allow creating events. Run pnpm connect:google.";
export const MAYBE_CREATED = "The event may have been created. Check Google Calendar before trying again.";
export const BAD_TIME_ZONE = "This time zone is not recognised.";
export const BAD_TIMES = "The event must end after it starts.";
export const BAD_ATTENDEES = "One of the guests is not a valid email address.";
export const TOO_MANY_ATTENDEES = `An event can have at most ${MAX_ATTENDEES} guests.`;

export interface EventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

/** The event resource sent to Google, and the parts of the reply that are read back. */
export interface GoogleEvent {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: EventTime;
  end?: EventTime;
  attendees?: { email?: string; displayName?: string; responseStatus?: string; self?: boolean; organizer?: boolean; resource?: boolean }[];
  organizer?: { email?: string; self?: boolean };
  conferenceData?: { createRequest: { requestId: string; conferenceSolutionKey: { type: "hangoutsMeet" } } };
}

export interface CreateEventRequest {
  url: string;
  query: Record<string, string | number>;
  body: GoogleEvent;
}

/** True when the browser's time zone is one this machine knows. */
export function validTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

interface LocalParts {
  date: string;
  midnight: boolean;
}

/** The calendar date of an instant in a time zone, and whether it falls exactly at midnight there. */
export function localDate(instant: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const midnight = get("hour") === "00" && get("minute") === "00" && get("second") === "00" && instant.getUTCMilliseconds() === 0;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, midnight };
}

/** A YYYY-MM-DD date moved by whole days. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * The first day and the day after the last day of an all-day event, as Google wants them (the end is
 * exclusive). An end at midnight is already the day after; an end later in a day includes that day.
 * An event always covers at least one day.
 */
export function allDayRange(startsAt: Date, endsAt: Date, timeZone: string): { start: string; end: string } {
  const start = localDate(startsAt, timeZone).date;
  const last = localDate(endsAt, timeZone);
  let end = last.midnight ? last.date : addDays(last.date, 1);
  if (end <= start) end = addDays(start, 1);
  return { start, end };
}

/** Trimmed, lowercased and deduped guests, or the reason they cannot be used. */
export function cleanAttendees(list: string[]): string[] | { error: string } {
  const seen = new Set<string>();
  for (const raw of list) {
    const email = raw.trim().toLowerCase();
    if (!email) continue;
    if (!isEmailAddress(email)) return { error: BAD_ATTENDEES };
    seen.add(email);
  }
  if (seen.size > MAX_ATTENDEES) return { error: TOO_MANY_ATTENDEES };
  return [...seen];
}

/**
 * Google lets the caller choose the event id (letters a to v and digits, 5 to 1024 long). The row's
 * own id without dashes fits, so a second insert of the same row is refused as a duplicate instead of
 * making a second event.
 */
export function eventIdFor(rowId: string): string {
  return rowId.toLowerCase().replace(/-/g, "");
}

/** The request that creates this row's event, or the reason it cannot be made. */
export function buildCreateEvent(row: CalendarOutboxRow): CreateEventRequest | { error: string } {
  if (!validTimeZone(row.time_zone)) return { error: BAD_TIME_ZONE };
  const startsAt = new Date(row.starts_at);
  const endsAt = new Date(row.ends_at);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) return { error: BAD_TIMES };
  const attendees = cleanAttendees(row.attendees);
  if (!Array.isArray(attendees)) return attendees;

  const body: GoogleEvent = { id: eventIdFor(row.id), summary: row.title.trim() };
  const description = row.description?.trim();
  const location = row.location?.trim();
  if (description) body.description = description;
  if (location) body.location = location;

  if (row.all_day) {
    const { start, end } = allDayRange(startsAt, endsAt, row.time_zone);
    body.start = { date: start };
    body.end = { date: end };
  } else {
    body.start = { dateTime: startsAt.toISOString(), timeZone: row.time_zone };
    body.end = { dateTime: endsAt.toISOString(), timeZone: row.time_zone };
  }
  if (attendees.length > 0) body.attendees = attendees.map((email) => ({ email }));

  const query: Record<string, string | number> = { sendUpdates: row.send_invites ? "all" : "none" };
  if (row.add_meet) {
    query.conferenceDataVersion = 1;
    body.conferenceData = { createRequest: { requestId: row.id, conferenceSolutionKey: { type: "hangoutsMeet" } } };
  }
  return { url: `${API}/calendars/${encodeURIComponent(row.calendar_id)}/events`, query, body };
}

/** An all-day event's date as midnight UTC; the all_day flag tells the app to ignore the time. */
export function toTimestamp(time: EventTime | undefined): string | null {
  if (time?.dateTime) return new Date(time.dateTime).toISOString();
  if (time?.date) return `${time.date}T00:00:00Z`;
  return null;
}

/** A Google event as it is stored in calendar_events. Null for cancelled events or ones without a start. */
export function storedEvent(
  event: GoogleEvent,
  owner: { userId: string; accountId: string; calendarId: string },
): TablesInsert<"calendar_events"> | null {
  const startsAt = toTimestamp(event.start);
  if (!event.id || event.status === "cancelled" || !startsAt) return null;
  const attendees = (event.attendees ?? [])
    .filter((a) => a.email && !a.resource)
    .map((a) => ({ email: a.email!.toLowerCase(), name: a.displayName ?? null, response: a.responseStatus ?? null, self: !!a.self, organizer: !!a.organizer }));
  return {
    user_id: owner.userId,
    account_id: owner.accountId,
    calendar_id: owner.calendarId,
    provider_event_id: event.id,
    title: event.summary ?? null,
    starts_at: startsAt,
    ends_at: toTimestamp(event.end),
    all_day: !event.start?.dateTime,
    location: event.location ?? null,
    attendees: attendees satisfies Json,
  };
}

/**
 * The calendar a created event is filed under. The sync stores the primary calendar by its real id
 * (your address), not "primary", so a created event uses the same id and the next sync matches it.
 */
export function createdCalendarId(row: Pick<CalendarOutboxRow, "calendar_id">, event: GoogleEvent): string {
  if (row.calendar_id === "primary" && event.organizer?.self && event.organizer.email) return event.organizer.email;
  return row.calendar_id;
}

/**
 * What a failed create means. A refusal (4xx) never made the event and says why; anything else may
 * have reached Google, so the row is failed with a warning and never sent again.
 */
export function createFailure(status: number | null, reason: string | null): string {
  if (status === null || status >= 500) return MAYBE_CREATED;
  if (status === 409) return MAYBE_CREATED; // the id is taken: this row was created before
  if (status === 401) return "Google sign-in expired or was removed. Run pnpm connect:google to reconnect.";
  if (status === 403 && reason && /rate|quota/i.test(reason)) return "Google Calendar is busy. Try again in a minute.";
  if (status === 429) return "Google Calendar is busy. Try again in a minute.";
  if (status === 403 && reason === "insufficientPermissions") return EVENTS_NOT_GRANTED;
  if (status === 403 || status === 404) return "You cannot add events to this calendar.";
  return "Google Calendar did not accept this event.";
}
