// Turns an iCalendar event (what iCloud Calendar sends over CalDAV) into a calendar_events row, stored
// the same way as a Google event. Pure, so it can be unit tested.

import type { Json, TablesInsert } from "@messages/db";
import { findMeetingLink } from "../calendar/meeting-link";

interface Property {
  name: string;
  params: Record<string, string>;
  value: string;
}

export interface IcsEvent {
  uid: string | null;
  recurrenceId: string | null;
  /** How the series repeats, on the series' own VEVENT (not on the occurrences iCloud expands). */
  rrule: string | null;
  cancelled: boolean;
  summary: string | null;
  location: string | null;
  description: string | null;
  /** The event's own link (URL), or the meeting link a calendar app keeps in its own property. */
  url: string | null;
  conference: string | null;
  start: Property | null;
  end: Property | null;
  duration: string | null;
  organizer: Property | null;
  attendees: Property[];
}

/** Splits "NAME;PARAM=a;PARAM2=\"b:c\":value" at the first colon outside quotes. */
export function parseLine(line: string): Property | null {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 1) return null;
  const parts: string[] = [];
  let current = "";
  quoted = false;
  for (const ch of line.slice(0, colon)) {
    if (ch === '"') quoted = !quoted;
    if (ch === ";" && !quoted) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf("=");
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: parts[0].toUpperCase(), params, value: line.slice(colon + 1) };
}

function unescapeText(s: string): string {
  return s.replace(/\\([nN,;\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

/** Every VEVENT in an iCalendar resource. Properties of nested components (alarms) are left out. */
export function parseEvents(text: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  let current: IcsEvent | null = null;
  let depth = 0; // components nested inside the VEVENT, such as a VALARM
  for (const line of text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      current = { uid: null, recurrenceId: null, rrule: null, cancelled: false, summary: null, location: null, description: null, url: null, conference: null, start: null, end: null, duration: null, organizer: null, attendees: [] };
      depth = 0;
      continue;
    }
    if (!current) continue;
    if (upper === "END:VEVENT" && depth === 0) {
      events.push(current);
      current = null;
      continue;
    }
    if (upper.startsWith("BEGIN:")) {
      depth++;
      continue;
    }
    if (upper.startsWith("END:")) {
      depth--;
      continue;
    }
    if (depth > 0) continue;
    const prop = parseLine(line);
    if (!prop) continue;
    switch (prop.name) {
      case "UID": current.uid = prop.value.trim() || null; break;
      case "RECURRENCE-ID": current.recurrenceId = prop.value.trim() || null; break;
      case "RRULE": current.rrule = prop.value.trim() || null; break;
      case "STATUS": current.cancelled = prop.value.trim().toUpperCase() === "CANCELLED"; break;
      case "SUMMARY": current.summary = unescapeText(prop.value).trim() || null; break;
      case "LOCATION": current.location = unescapeText(prop.value).replace(/\s*\n\s*/g, ", ").trim() || null; break;
      case "DESCRIPTION": current.description = unescapeText(prop.value).trim() || null; break;
      case "URL": current.url = prop.value.trim() || null; break;
      case "X-GOOGLE-CONFERENCE":
      case "X-MICROSOFT-SKYPETEAMSMEETINGURL": current.conference = prop.value.trim() || null; break;
      case "DTSTART": current.start = prop; break;
      case "DTEND": current.end = prop; break;
      case "DURATION": current.duration = prop.value.trim(); break;
      case "ORGANIZER": current.organizer = prop; break;
      case "ATTENDEE": current.attendees.push(prop); break;
    }
  }
  return events;
}

/** The instant a wall-clock time in a zone is, or null when the zone is not one this runtime knows. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, zone: string): number | null {
  try {
    const format = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    const offsetAt = (instant: number) => {
      const p = Object.fromEntries(format.formatToParts(new Date(instant)).map((x) => [x.type, Number(x.value)]));
      return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant / 1000) * 1000;
    };
    const wall = Date.UTC(y, mo - 1, d, h, mi, s);
    const first = wall - offsetAt(wall);
    return wall - offsetAt(first); // once more, for a time near a clock change
  } catch {
    return null;
  }
}

/**
 * A UTC timestamp from a DTSTART or DTEND, plus whether it was a whole day. A date-only value is stored at
 * midnight UTC on that date, like Google's. A time with a zone is converted; a floating time (no zone) is
 * read as UTC.
 */
export function icsTimestamp(prop: Property | null): { at: string; allDay: boolean } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i.exec(prop?.value.trim() ?? "");
  if (!prop || !m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (m[4] === undefined || prop.params.VALUE === "DATE") {
    return { at: `${m[1]}-${m[2]}-${m[3]}T00:00:00Z`, allDay: true };
  }
  const [h, mi, s] = [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  const zone = prop.params.TZID;
  const ms = m[7] || !zone ? Date.UTC(y, mo - 1, d, h, mi, s) : (zonedToUtc(y, mo, d, h, mi, s, zone) ?? Date.UTC(y, mo - 1, d, h, mi, s));
  return Number.isNaN(ms) ? null : { at: new Date(ms).toISOString(), allDay: false };
}

/** Milliseconds in an iCalendar duration such as "PT1H30M" or "P1D". Null when it is not one. */
export function icsDuration(value: string | null): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value ?? "");
  if (!m || !value || value.replace(/[+-]?P/i, "") === "" || /T$/i.test(value)) return null;
  const ms = ((Number(m[2] ?? 0) * 7 + Number(m[3] ?? 0)) * 86_400 + Number(m[4] ?? 0) * 3600 + Number(m[5] ?? 0) * 60 + Number(m[6] ?? 0)) * 1000;
  return m[1] === "-" ? -ms : ms;
}

/** iCalendar's answers in Google's words, so every calendar's attendees read the same. */
const RESPONSES: Record<string, string> = {
  ACCEPTED: "accepted",
  TENTATIVE: "tentative",
  DECLINED: "declined",
  "NEEDS-ACTION": "needsAction",
};

function emailOf(prop: Property | null): string | null {
  const m = /^mailto:(.+)$/i.exec(prop?.value.trim() ?? "");
  return m?.[1].includes("@") ? m[1].toLowerCase() : null;
}

const MAX_NOTES = 5000; // an event's notes are kept up to here, as a long invitation can be pages
/** A Zoom, Meet, Teams or Webex link: the event's own, else the first in its notes or location. Only https links. */
export function meetingLink(event: Pick<IcsEvent, "conference" | "url" | "description" | "location">): string | null {
  return findMeetingLink([event.conference, event.url], [event.description, event.location]);
}

/** One expanded event as it is stored in calendar_events. Null for cancelled events or ones without a start. */
export function storedIcsEvent(
  event: IcsEvent,
  owner: { userId: string; accountId: string; calendarId: string; calendarName?: string | null; resourceUrl?: string | null; selfAddresses: Set<string> },
): TablesInsert<"calendar_events"> | null {
  const start = icsTimestamp(event.start);
  if (!event.uid || event.cancelled || !start) return null;

  let endsAt = icsTimestamp(event.end)?.at ?? null;
  if (!endsAt) {
    const length = icsDuration(event.duration);
    if (length !== null) endsAt = new Date(Date.parse(start.at) + length).toISOString();
    else if (start.allDay) endsAt = new Date(Date.parse(start.at) + 86_400_000).toISOString();
  }

  const organizer = emailOf(event.organizer);
  const attendees = event.attendees
    .filter((a) => emailOf(a) && !["RESOURCE", "ROOM"].includes(a.params.CUTYPE?.toUpperCase() ?? ""))
    .map((a) => {
      const email = emailOf(a)!;
      return {
        email,
        name: a.params.CN || null,
        response: RESPONSES[a.params.PARTSTAT?.toUpperCase() ?? ""] ?? null,
        self: owner.selfAddresses.has(email),
        organizer: email === organizer,
      };
    });
  // The organizer is not always listed as an attendee; Google lists them, so they are added to say who it is with.
  if (organizer && !attendees.some((a) => a.email === organizer)) {
    attendees.unshift({ email: organizer, name: event.organizer?.params.CN || null, response: "accepted", self: owner.selfAddresses.has(organizer), organizer: true });
  }

  return {
    user_id: owner.userId,
    account_id: owner.accountId,
    calendar_id: owner.calendarId,
    // Every occurrence of a repeating event shares a UID; its RECURRENCE-ID tells them apart.
    provider_event_id: event.recurrenceId ? `${event.uid}#${event.recurrenceId}` : event.uid,
    title: event.summary,
    starts_at: start.at,
    ends_at: endsAt,
    all_day: start.allDay,
    location: event.location,
    attendees: attendees satisfies Json,
    description: event.description?.slice(0, MAX_NOTES) ?? null,
    calendar_name: owner.calendarName ?? null,
    conference_url: meetingLink(event),
    resource_url: owner.resourceUrl ?? null,
    // Every occurrence of a repeating event shares the UID, so that is what finds the whole series.
    series_id: event.recurrenceId ? event.uid : null,
    // On the series' own VEVENT only; the sync gives its occurrences the series' rule.
    recurrence: event.rrule,
  };
}
