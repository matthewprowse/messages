// Turns a queued calendar_outbox or calendar_deletes row into the Microsoft Graph request that carries it out, and
// says what a refused one means. Pure: no network, no database. The Outlook Calendar connector
// (connectors/outlook-calendar.ts) sends what these build, the same queue Google Calendar reads.

import { BAD_TIME_ZONE, BAD_TIMES, allDayRange, cleanAttendees, validTimeZone, type CalendarOutboxRow } from "../calendar/create-event";
import { wallMs, wallString } from "../calendar/update-event";

export const RECURRENCE_NOT_SUPPORTED = "Outlook Calendar events cannot be made to repeat from here yet.";
export const INVITES_ALWAYS_SENT = "Outlook Calendar always sends an invitation to a guest. Turn on Send Invites, or remove the guests.";
export const WRITE_NOT_GRANTED = "Outlook Calendar has not been allowed to make changes yet. Allow editing, then try again.";
export const MAYBE_CREATED = "The event may have been created. Check Outlook Calendar before trying again.";

/** Sent with a write so Graph answers in UTC and plain text, which is how events are stored (see microsoft/calendar-event.ts). */
export const READ_BACK = ['outlook.timezone="UTC"', 'outlook.body-content-type="text"'];

export interface GraphCreateRequest {
  url: string;
  body: Record<string, unknown>;
}

/** Where a new event is posted: the default calendar for "primary", else the chosen one. */
export function createUrl(calendarId: string): string {
  return calendarId === "primary" ? "/me/calendar/events" : `/me/calendars/${encodeURIComponent(calendarId)}/events`;
}

/**
 * The request that creates this row's event, or why it cannot be made. `transactionId` is the row's own id, which
 * Graph uses to refuse a second POST of the same event, so a retry cannot make two.
 */
export function buildGraphCreate(row: CalendarOutboxRow): GraphCreateRequest | { error: string } {
  if (!validTimeZone(row.time_zone)) return { error: BAD_TIME_ZONE };
  const startsAt = new Date(row.starts_at);
  const endsAt = new Date(row.ends_at);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) return { error: BAD_TIMES };
  const attendees = cleanAttendees(row.attendees);
  if (!Array.isArray(attendees)) return attendees;
  if (row.recurrence) return { error: RECURRENCE_NOT_SUPPORTED };
  // Graph has no switch to keep an invitation back, so guests with Send Invites off would be told anyway.
  if (attendees.length > 0 && !row.send_invites) return { error: INVITES_ALWAYS_SENT };

  const body: Record<string, unknown> = { subject: row.title.trim(), transactionId: row.id, isAllDay: row.all_day };
  const description = row.description?.trim();
  const location = row.location?.trim();
  if (description) body.body = { contentType: "text", content: description };
  if (location) body.location = { displayName: location };
  if (row.all_day) {
    const { start, end } = allDayRange(startsAt, endsAt, row.time_zone);
    body.start = { dateTime: `${start}T00:00:00`, timeZone: row.time_zone };
    body.end = { dateTime: `${end}T00:00:00`, timeZone: row.time_zone };
  } else {
    body.start = { dateTime: wallString(wallMs(startsAt, row.time_zone)), timeZone: row.time_zone };
    body.end = { dateTime: wallString(wallMs(endsAt, row.time_zone)), timeZone: row.time_zone };
  }
  if (attendees.length > 0) body.attendees = attendees.map((address) => ({ emailAddress: { address }, type: "required" }));
  return { url: createUrl(row.calendar_id), body };
}

/** The event id a delete or an answer to a whole series is sent to: the series' master, else the event itself. */
export function targetId(event: { provider_event_id: string; series_id: string | null }, wholeSeries: boolean): string {
  return wholeSeries && event.series_id ? event.series_id : event.provider_event_id;
}

/** What a refused create means. A 4xx never made the event; anything else may have, so it is not sent again. */
export function graphCreateFailure(status: number | null, graphCode: string | null): string {
  if (status === 401) return "Microsoft sign-in expired or was removed. Reconnect Microsoft in Settings, Accounts.";
  if (status === 403) return graphCode === "ErrorAccessDenied" ? WRITE_NOT_GRANTED : "You cannot add events to this calendar.";
  if (status === 404) return "You cannot add events to this calendar.";
  if (status === 429) return "Outlook Calendar is busy. Try again in a minute.";
  if (status === null || status >= 500 || status === 409) return MAYBE_CREATED;
  return "Outlook Calendar did not accept this event.";
}

/** What a refused delete means. */
export function graphDeleteFailure(status: number | null, graphCode: string | null): string {
  if (status === 401) return "Microsoft sign-in expired or was removed. Reconnect Microsoft in Settings, Accounts.";
  if (status === 403) return graphCode === "ErrorAccessDenied" ? WRITE_NOT_GRANTED : "You cannot delete events from this calendar.";
  if (status === 429) return "Outlook Calendar is busy. Try again in a minute.";
  return "Outlook Calendar did not delete this event. Try again.";
}
