// Changing an event from the app: calendar_updates rows are queued by the app, claimed here, carried out by
// the account's connector, and settled once the stored copy has the change too. A row is either new details
// for the event (kind update) or the account's own answer to an invitation (kind rsvp). Everything that does
// not need the network is here as pure functions, so it can be unit tested.

import type { Json, Tables, TablesUpdate } from "@messages/db";
import { zonedToUtc } from "../caldav/ical";
import { BAD_TIME_ZONE, BAD_TIMES, addDays, allDayRange, cleanAttendees, localDate, validTimeZone, type GoogleEvent } from "./create-event";
import type { StoredCalendarEvent } from "./delete-event";
import { BAD_RULE, validRule, withRule } from "./recurrence";

export type CalendarUpdateRow = Tables<"calendar_updates">;
export type UpdateResponse = "accepted" | "tentative" | "declined";

export const GONE = "This event no longer exists.";
export const UPDATE_NOT_GRANTED = "Reconnect Google in Settings, Connected Accounts, to allow changing events.";
export const NOT_A_GUEST = "You are not a guest of this event, so there is nothing to answer.";
export const SWITCH_ALL_DAY = "Change one event at a time to switch between all day and timed.";
export const ONLY_ORGANIZER = "Only the organizer can change this event.";


// ---------------------------------------------------------------------------
// The change a row asks for
// ---------------------------------------------------------------------------

export interface ChangeTime {
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  timeZone: string;
}

/** A row read and checked: text trimmed, guests cleaned. A text left undefined is unchanged; "" clears a location or notes. */
export interface Change {
  kind: "update" | "rsvp";
  scope: "occurrence" | "series";
  title?: string;
  description?: string;
  location?: string;
  time?: ChangeTime;
  /** The whole new guest list (lowercase), without you. */
  attendees?: string[];
  /** A new rule for the whole series, or one that makes a single event repeat. */
  recurrence?: string;
  sendInvites: boolean;
  response?: UpdateResponse;
}

/** The change a queued row asks for, or the reason it cannot be made. */
export function readChange(row: CalendarUpdateRow): Change | { error: string } {
  const change: Change = { kind: row.kind === "rsvp" ? "rsvp" : "update", scope: row.scope === "series" ? "series" : "occurrence", sendInvites: row.send_invites };
  if (change.kind === "rsvp") {
    if (row.response !== "accepted" && row.response !== "tentative" && row.response !== "declined") return { error: "This answer is not one the calendar knows." };
    change.response = row.response;
    return change;
  }
  if (row.title !== null) {
    const title = row.title.trim();
    if (!title) return { error: "An event needs a title." };
    change.title = title;
  }
  if (row.description !== null) change.description = row.description.trim();
  if (row.location !== null) change.location = row.location.trim();
  if (row.starts_at !== null && row.ends_at !== null && row.all_day !== null && row.time_zone !== null) {
    if (!validTimeZone(row.time_zone)) return { error: BAD_TIME_ZONE };
    const startsAt = new Date(row.starts_at);
    const endsAt = new Date(row.ends_at);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) return { error: BAD_TIMES };
    change.time = { startsAt, endsAt, allDay: row.all_day, timeZone: row.time_zone };
  }
  if (row.attendees !== null) {
    const attendees = cleanAttendees(row.attendees);
    if (!Array.isArray(attendees)) return attendees;
    change.attendees = attendees;
  }
  if (row.recurrence !== null) {
    if (!validRule(row.recurrence)) return { error: BAD_RULE };
    change.recurrence = row.recurrence;
  }
  return change;
}

// ---------------------------------------------------------------------------
// Time arithmetic
// ---------------------------------------------------------------------------

/** The wall clock of an instant in a zone, as milliseconds since 1970 read as if that wall clock were UTC. */
export function wallMs(instant: string | Date, timeZone: string): number {
  const at = typeof instant === "string" ? new Date(instant) : instant;
  const { date } = localDate(at, timeZone);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d, get("hour"), get("minute"), get("second"));
}

/** The instant a wall clock (as wallMs reads it) is in a zone. */
export function wallToIso(ms: number, timeZone: string): string {
  const d = new Date(ms);
  const at = zonedToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), timeZone);
  return new Date(at ?? ms).toISOString();
}

/** A wall clock as "2026-10-26T09:00:00", which Google and Graph read in the zone they are sent with. */
export function wallString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19);
}

const dayNumber = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/**
 * How a change to one occurrence moves the whole series: by days for an all-day event, or by the wall clock
 * (so 09:00 stays 09:00 across a clock change). The length is the new length of an occurrence.
 */
export type SeriesShift = { kind: "date"; days: number; length: number } | { kind: "time"; timeZone: string; delta: number; length: number };

export function seriesShift(time: ChangeTime, stored: Pick<StoredCalendarEvent, "starts_at" | "ends_at" | "all_day">): SeriesShift | { error: string } {
  if (stored.all_day !== time.allDay) return { error: SWITCH_ALL_DAY };
  if (time.allDay) {
    const { start, end } = allDayRange(time.startsAt, time.endsAt, time.timeZone);
    return { kind: "date", days: dayNumber(start) - dayNumber(stored.starts_at.slice(0, 10)), length: dayNumber(end) - dayNumber(start) };
  }
  return {
    kind: "time",
    timeZone: time.timeZone,
    delta: wallMs(time.startsAt, time.timeZone) - wallMs(stored.starts_at, time.timeZone),
    length: wallMs(time.endsAt, time.timeZone) - wallMs(time.startsAt, time.timeZone),
  };
}

export interface StoredTimes {
  starts_at: string;
  ends_at: string;
  all_day: boolean;
}

/** The times a change gives the occurrence it was made on, as they are stored. */
export function exactTimes(time: ChangeTime): StoredTimes {
  if (time.allDay) {
    const { start, end } = allDayRange(time.startsAt, time.endsAt, time.timeZone);
    return { starts_at: `${start}T00:00:00Z`, ends_at: `${end}T00:00:00Z`, all_day: true };
  }
  return { starts_at: time.startsAt.toISOString(), ends_at: time.endsAt.toISOString(), all_day: false };
}

/** Another occurrence of the series after the whole series has moved. */
export function shiftedTimes(stored: Pick<StoredCalendarEvent, "starts_at" | "all_day">, shift: SeriesShift): StoredTimes {
  if (shift.kind === "date") {
    const start = addDays(stored.starts_at.slice(0, 10), shift.days);
    return { starts_at: `${start}T00:00:00Z`, ends_at: `${addDays(start, shift.length)}T00:00:00Z`, all_day: true };
  }
  const start = wallMs(stored.starts_at, shift.timeZone) + shift.delta;
  return { starts_at: wallToIso(start, shift.timeZone), ends_at: wallToIso(start + shift.length, shift.timeZone), all_day: false };
}

// ---------------------------------------------------------------------------
// The stored copy
// ---------------------------------------------------------------------------

interface StoredGuest {
  email: string;
  name?: string | null;
  response?: string | null;
  self?: boolean;
  organizer?: boolean;
}

function guestsOf(raw: Json): StoredGuest[] {
  return Array.isArray(raw) ? raw.filter((a): a is StoredGuest & Json => !!a && typeof a === "object" && !Array.isArray(a) && typeof (a as { email?: unknown }).email === "string") : [];
}

/** The stored guests after the change: yours and the organizer's stay, the rest are the new list, keeping their answers. */
export function guestsAfter(stored: Json, wanted: string[] | undefined, response: UpdateResponse | undefined): Json {
  let guests = guestsOf(stored);
  if (wanted) {
    const keep = guests.filter((g) => g.self || g.organizer || wanted.includes(g.email.toLowerCase()));
    const have = new Set(keep.map((g) => g.email.toLowerCase()));
    guests = [...keep, ...wanted.filter((e) => !have.has(e)).map((email): StoredGuest => ({ email, name: null, response: "needsAction", self: false, organizer: false }))];
  }
  if (response) guests = guests.map((g) => (g.self ? { ...g, response } : g));
  return guests as unknown as Json;
}

/** The stored event's columns after the change. `times` are the occurrence's new times, when the change moves them. */
export function storedPatch(stored: Pick<StoredCalendarEvent, "attendees">, change: Change, times: StoredTimes | null): TablesUpdate<"calendar_events"> {
  const patch: TablesUpdate<"calendar_events"> = {};
  if (change.title !== undefined) patch.title = change.title;
  if (change.description !== undefined) patch.description = change.description || null;
  if (change.location !== undefined) patch.location = change.location || null;
  if (times) Object.assign(patch, times);
  if (change.attendees !== undefined || change.response) patch.attendees = guestsAfter(stored.attendees, change.attendees, change.response);
  if (change.recurrence !== undefined) patch.recurrence = change.recurrence;
  return patch;
}

// ---------------------------------------------------------------------------
// Google Calendar
// ---------------------------------------------------------------------------

/** Whether the event must be read before it is changed: guests and series times are merged into what it has. */
export function googleNeedsRead(change: Change, series: boolean): boolean {
  return change.kind === "rsvp" || change.attendees !== undefined || change.recurrence !== undefined || (series && change.time !== undefined);
}

/** Your entry and the organizer's are always kept, with resources (rooms); everyone else is the new list, keeping their answers. */
export function mergeGoogleGuests(current: NonNullable<GoogleEvent["attendees"]>, wanted: string[]): NonNullable<GoogleEvent["attendees"]> {
  const keep = current.filter((a) => a.self || a.organizer || a.resource || (a.email && wanted.includes(a.email.toLowerCase())));
  const have = new Set(keep.map((a) => a.email?.toLowerCase()));
  return [...keep, ...wanted.filter((e) => !have.has(e)).map((email) => ({ email }))];
}

/**
 * The body of the events.patch request for a change, or why it cannot be made. `current` is the event as Google
 * has it now (the series' own event for a change to the whole series), needed when googleNeedsRead says so.
 * `shift` says how the series moves, for a change of time to the whole series.
 */
export function googleBody(change: Change, current: GoogleEvent | null, shift: SeriesShift | null): { body: GoogleEvent } | { error: string } {
  if (change.kind === "rsvp") {
    const guests = current?.attendees ?? [];
    if (!guests.some((a) => a.self)) return { error: NOT_A_GUEST };
    return { body: { attendees: guests.map((a) => (a.self ? { ...a, responseStatus: change.response } : a)) } };
  }
  const body: GoogleEvent = {};
  if (change.title !== undefined) body.summary = change.title;
  if (change.description !== undefined) body.description = change.description;
  if (change.location !== undefined) body.location = change.location;
  if (change.time) {
    const time = change.time;
    if (!shift) {
      if (time.allDay) {
        const { start, end } = allDayRange(time.startsAt, time.endsAt, time.timeZone);
        body.start = { date: start };
        body.end = { date: end };
      } else {
        body.start = { dateTime: time.startsAt.toISOString(), timeZone: time.timeZone };
        body.end = { dateTime: time.endsAt.toISOString(), timeZone: time.timeZone };
      }
    } else if (shift.kind === "date") {
      const from = current?.start?.date;
      if (!from) return { error: SWITCH_ALL_DAY };
      const start = addDays(from, shift.days);
      body.start = { date: start };
      body.end = { date: addDays(start, shift.length) };
    } else {
      const from = current?.start?.dateTime;
      if (!from) return { error: SWITCH_ALL_DAY };
      const zone = current.start?.timeZone && validTimeZone(current.start.timeZone) ? current.start.timeZone : shift.timeZone;
      const start = wallMs(from, zone) + shift.delta;
      body.start = { dateTime: wallString(start), timeZone: zone };
      body.end = { dateTime: wallString(start + shift.length), timeZone: zone };
    }
  }
  if (change.attendees !== undefined) body.attendees = mergeGoogleGuests(current?.attendees ?? [], change.attendees);
  // Skipped dates and the rest of the series' lines stay as they are.
  if (change.recurrence !== undefined) body.recurrence = withRule(current?.recurrence, change.recurrence);
  return { body };
}

/** What a refused change means. */
export function googleUpdateFailure(status: number | null, reason: string | null): string {
  if (status === 401) return "Google sign-in expired or was removed. Reconnect Google in Settings, Connected Accounts.";
  if (status === 403 && reason === "insufficientPermissions") return UPDATE_NOT_GRANTED;
  if (status === 429 || (status === 403 && reason && /rate|quota/i.test(reason))) return "Google Calendar is busy. Try again in a minute.";
  if (status === 403) return "You cannot change this event.";
  if (status === 404 || status === 410) return GONE;
  if (status !== null && status >= 500) return "Google Calendar did not respond. Check the event before trying again.";
  return "Google Calendar did not accept this change.";
}

// ---------------------------------------------------------------------------
// Microsoft Graph
// ---------------------------------------------------------------------------

export interface GraphGuest {
  emailAddress?: { address?: string | null; name?: string | null } | null;
  type?: string;
}

/** The body of the PATCH for an Outlook event, or why it cannot be made. `current` is the guests it has now. */
export function graphBody(change: Change, current: GraphGuest[]): { body: Record<string, unknown> } | { error: string } {
  const body: Record<string, unknown> = {};
  if (change.title !== undefined) body.subject = change.title;
  if (change.description !== undefined) body.body = { contentType: "text", content: change.description };
  if (change.location !== undefined) body.location = { displayName: change.location };
  if (change.time) {
    const time = change.time;
    body.isAllDay = time.allDay;
    if (time.allDay) {
      const { start, end } = allDayRange(time.startsAt, time.endsAt, time.timeZone);
      body.start = { dateTime: `${start}T00:00:00`, timeZone: time.timeZone };
      body.end = { dateTime: `${end}T00:00:00`, timeZone: time.timeZone };
    } else {
      body.start = { dateTime: wallString(wallMs(time.startsAt, time.timeZone)), timeZone: time.timeZone };
      body.end = { dateTime: wallString(wallMs(time.endsAt, time.timeZone)), timeZone: time.timeZone };
    }
  }
  if (change.attendees !== undefined) {
    const wanted = change.attendees;
    const keep = current.filter((g) => g.emailAddress?.address && wanted.includes(g.emailAddress.address.toLowerCase()));
    const have = new Set(keep.map((g) => g.emailAddress!.address!.toLowerCase()));
    body.attendees = [...keep, ...wanted.filter((e) => !have.has(e)).map((address) => ({ emailAddress: { address }, type: "required" }))];
  }
  return { body };
}

/** The endpoint that answers an invitation in Outlook. */
export const GRAPH_RESPONSE: Record<UpdateResponse, string> = { accepted: "accept", tentative: "tentativelyAccept", declined: "decline" };

export function graphUpdateFailure(status: number | null): string {
  if (status === 401) return "Microsoft sign-in expired or was removed. Reconnect Microsoft in Settings, Accounts.";
  if (status === 403) return "You cannot change this event.";
  if (status === 404) return GONE;
  if (status === 429) return "Outlook Calendar is busy. Try again in a minute.";
  if (status !== null && status >= 500) return "Outlook Calendar did not respond. Check the event before trying again.";
  return "Outlook Calendar did not accept this change.";
}
