// Turns a queued calendar_outbox row into the iCalendar file that creates it in iCloud Calendar, and says
// what a refusal means. Pure functions only, so all of it is unit tested.

import { isEmailAddress } from "../send/from-address";
import {
  BAD_TIMES,
  BAD_TIME_ZONE,
  allDayRange,
  cleanAttendees,
  eventIdFor,
  validTimeZone,
  type CalendarOutboxRow,
} from "../calendar/create-event";
import { BAD_RULE, validRule } from "../calendar/recurrence";
import { wallMs, wallString } from "../calendar/update-event";

export const MAYBE_CREATED = "The event may have been created. Check iCloud Calendar before trying again.";
export const SIGN_IN_REJECTED = "iCloud rejected the sign-in. Run pnpm connect:icloud-calendar to reconnect.";
export const NO_ORGANIZER = "iCloud did not say which address to invite from. Remove the guests, or reconnect with pnpm connect:icloud-calendar.";

/** Text as iCalendar wants it: backslash, semicolon, comma and line breaks escaped. */
function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** A line folded to 75 bytes, the continuation lines starting with a space. Never splits a character. */
export function fold(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    if (bytes + size > (out.length === 0 ? 75 : 74)) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.map((l, i) => (i === 0 ? l : ` ${l}`));
}

/** 20261024T080000Z */
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const day = (date: string) => date.replace(/-/g, "");
/** 20261024T100000, the wall clock of an instant in a zone, for a TZID time. */
const wallIn = (d: Date, timeZone: string) => wallString(wallMs(d, timeZone)).replace(/[-:]/g, "");
const UTC_ZONES = new Set(["UTC", "Etc/UTC", "GMT", "Etc/GMT"]);

export interface IcsRequest {
  uid: string;
  ics: string;
}

/**
 * The event file for this row, or the reason it cannot be made. `organizer` is the address the invitations
 * come from; it is needed only when there are guests. With send_invites off the guests are marked
 * SCHEDULE-AGENT=CLIENT, which tells iCloud not to email them.
 */
export function buildIcs(row: CalendarOutboxRow, organizer: string | null, now = new Date()): IcsRequest | { error: string } {
  if (!validTimeZone(row.time_zone)) return { error: BAD_TIME_ZONE };
  const startsAt = new Date(row.starts_at);
  const endsAt = new Date(row.ends_at);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) return { error: BAD_TIMES };
  const attendees = cleanAttendees(row.attendees);
  if (!Array.isArray(attendees)) return attendees;
  if (attendees.length > 0 && (!organizer || !isEmailAddress(organizer))) return { error: NO_ORGANIZER };

  const uid = eventIdFor(row.id);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Messages//iCloud Calendar//EN", "CALSCALE:GREGORIAN", "BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${utc(now)}`];
  if (row.all_day) {
    const { start, end } = allDayRange(startsAt, endsAt, row.time_zone);
    lines.push(`DTSTART;VALUE=DATE:${day(start)}`, `DTEND;VALUE=DATE:${day(end)}`);
  } else if (UTC_ZONES.has(row.time_zone)) {
    lines.push(`DTSTART:${utc(startsAt)}`, `DTEND:${utc(endsAt)}`);
  } else {
    // In the zone it was made in, as Calendar on your devices writes it: a UTC time shows in iCloud as GMT.
    lines.push(`DTSTART;TZID=${row.time_zone}:${wallIn(startsAt, row.time_zone)}`, `DTEND;TZID=${row.time_zone}:${wallIn(endsAt, row.time_zone)}`);
  }
  if (row.recurrence) {
    if (!validRule(row.recurrence)) return { error: BAD_RULE };
    lines.push(`RRULE:${row.recurrence}`);
  }
  lines.push(`SUMMARY:${escapeText(row.title.trim())}`);
  const location = row.location?.trim();
  const description = row.description?.trim();
  if (location) lines.push(`LOCATION:${escapeText(location)}`);
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  if (attendees.length > 0) {
    const agent = row.send_invites ? "" : ";SCHEDULE-AGENT=CLIENT";
    lines.push(`ORGANIZER:mailto:${organizer}`, `ATTENDEE;PARTSTAT=ACCEPTED:mailto:${organizer}`);
    for (const email of attendees) {
      if (email === organizer) continue;
      lines.push(`ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE${agent}:mailto:${email}`);
    }
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return { uid, ics: lines.flatMap(fold).join("\r\n") + "\r\n" };
}

/**
 * What a failed create means. A refusal (4xx) never made the event and says why; anything else, including a
 * request that timed out, may have reached iCloud, so the row is failed with a warning and never sent again.
 */
export function createFailure(status: number | null): string {
  if (status === null || status >= 500) return MAYBE_CREATED;
  if (status === 412) return MAYBE_CREATED; // the event is already there: this row was created before
  if (status === 401) return SIGN_IN_REJECTED;
  if (status === 403) return "You cannot add events to this calendar.";
  if (status === 404) return "iCloud could not find the calendar. Try again in a few minutes.";
  if (status === 429) return "iCloud Calendar is busy. Try again in a minute.";
  return "iCloud Calendar did not accept this event.";
}
