// Invitations in conversations: reads the .ics file an invitation email carries (Google, Outlook and Apple all attach
// one) into the few facts a card needs, and finds the calendar event that invitation became. Pure, so it is unit tested;
// fetching the file and answering are in components/invite-card.tsx.
//
// The calendar has the event once the sync has seen the invitation, under the calendar's own id, which the file does
// not carry. So the file is matched to the event the same way a person would: same start, same title.

import type { Attachment } from "./types";
import type { CalendarEvent } from "./calendar";
import { instantAt } from "./free-times";

export interface Invite {
  uid: string | null;
  /** REQUEST for an invitation or update, CANCEL when it is withdrawn; null when the file does not say. */
  method: string | null;
  cancelled: boolean;
  title: string;
  /** Instant as ISO; for an all-day invitation midnight UTC on its date, like the stored events. */
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  organizer: string | null;
  /** The invitation repeats; only its first event has the start the file gives. */
  repeats: boolean;
}

/** Whether an attachment is probably a calendar invitation: a .ics file. */
export function isInviteFile(a: Pick<Attachment, "name">): boolean {
  return /\.ics$/i.test(a.name.trim());
}

/** The invitation file among a message's attachments, hidden or not, if it has one. */
export function inviteAttachment(attachments: Attachment[] | undefined): Attachment | undefined {
  return attachments?.find(isInviteFile);
}

// Windows zone names, as Outlook writes them in TZID. Only the zones people are likely to have.
const WINDOWS_ZONES: Record<string, string> = {
  "utc": "UTC", "south africa standard time": "Africa/Johannesburg", "namibia standard time": "Africa/Windhoek", "e. africa standard time": "Africa/Nairobi",
  "w. central africa standard time": "Africa/Lagos", "egypt standard time": "Africa/Cairo", "gmt standard time": "Europe/London", "w. europe standard time": "Europe/Berlin",
  "romance standard time": "Europe/Paris", "central europe standard time": "Europe/Budapest", "central european standard time": "Europe/Warsaw", "fle standard time": "Europe/Kiev",
  "gtb standard time": "Europe/Bucharest", "turkey standard time": "Europe/Istanbul", "russian standard time": "Europe/Moscow", "israel standard time": "Asia/Jerusalem",
  "arab standard time": "Asia/Riyadh", "arabian standard time": "Asia/Dubai", "india standard time": "Asia/Calcutta", "china standard time": "Asia/Shanghai",
  "singapore standard time": "Asia/Singapore", "tokyo standard time": "Asia/Tokyo", "aus eastern standard time": "Australia/Sydney", "w. australia standard time": "Australia/Perth",
  "new zealand standard time": "Pacific/Auckland", "pacific standard time": "America/Los_Angeles", "mountain standard time": "America/Denver", "central standard time": "America/Chicago",
  "eastern standard time": "America/New_York", "atlantic standard time": "America/Halifax", "e. south america standard time": "America/Sao_Paulo",
};

function ianaOf(zone: string): string | null {
  const name = zone.trim().replace(/^"|"$/g, "");
  const mapped = WINDOWS_ZONES[name.toLowerCase()] ?? name;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: mapped });
    return mapped;
  } catch {
    return null;
  }
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Folded lines joined, then each split into name, parameters and value. Parameters may be quoted and hold colons. */
function propsOf(text: string): Prop[] {
  const out: Prop[] = [];
  for (const line of text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
    const colon = (() => {
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') quoted = !quoted;
        else if (line[i] === ":" && !quoted) return i;
      }
      return -1;
    })();
    if (colon < 1) continue;
    const [name, ...rest] = line.slice(0, colon).split(";");
    const params: Record<string, string> = {};
    for (const p of rest) {
      const eq = p.indexOf("=");
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
    }
    out.push({ name: name.toUpperCase(), params, value: line.slice(colon + 1) });
  }
  return out;
}

const unescapeText = (v: string) => v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1").trim();

/** A DTSTART or DTEND as an instant, and whether it was a whole day. A floating time (no zone) is read as UTC. */
function when(prop: Prop | undefined): { at: string; allDay: boolean } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i.exec(prop?.value.trim() ?? "");
  if (!prop || !m) return null;
  if (m[4] === undefined || prop.params.VALUE === "DATE") return { at: `${m[1]}-${m[2]}-${m[3]}T00:00:00Z`, allDay: true };
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  const minutes = Number(m[4]) * 60 + Number(m[5]);
  const zone = prop.params.TZID && !m[7] ? ianaOf(prop.params.TZID) : "UTC";
  if (!zone) return null;
  return { at: new Date(instantAt(day, minutes, zone) + Number(m[6] ?? 0) * 1000).toISOString(), allDay: false };
}

/** The first event of an .ics file as an Invite, or null when the file has none or no readable start. */
export function parseInvite(ics: string): Invite | null {
  const props = propsOf(ics);
  const method = props.find((p) => p.name === "METHOD")?.value.trim().toUpperCase() ?? null;
  // Only the first VEVENT's own properties, not those of an alarm inside it.
  const begin = props.findIndex((p) => p.name === "BEGIN" && p.value.trim().toUpperCase() === "VEVENT");
  if (begin < 0) return null;
  const event: Prop[] = [];
  let depth = 0;
  for (const p of props.slice(begin + 1)) {
    if (p.name === "BEGIN") depth++;
    else if (p.name === "END") {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0) event.push(p);
  }
  const get = (name: string) => event.find((p) => p.name === name);
  const start = when(get("DTSTART"));
  if (!start) return null;
  const end = when(get("DTEND"));
  const organizer = /^mailto:(.+)$/i.exec(get("ORGANIZER")?.value.trim() ?? "")?.[1]?.toLowerCase() ?? null;
  return {
    uid: get("UID")?.value.trim() || null,
    method,
    cancelled: method === "CANCEL" || get("STATUS")?.value.trim().toUpperCase() === "CANCELLED",
    title: unescapeText(get("SUMMARY")?.value ?? "") || "No Title",
    startsAt: start.at,
    endsAt: end?.at ?? null,
    allDay: start.allDay,
    location: unescapeText(get("LOCATION")?.value ?? "").replace(/\s*\n\s*/g, ", ") || null,
    organizer,
    repeats: !!get("RRULE"),
  };
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The calendar event this invitation became: the same start (the same day for an all-day one) and the same title. When
 * the title was changed since, a single event at that start from the invitation's organizer still counts. Null when the
 * sync has not stored it yet, or the invitation repeats and this is not its first event.
 */
export function matchInvite(invite: Invite, events: CalendarEvent[]): CalendarEvent | null {
  const sameStart = events.filter((e) => (invite.allDay ? e.allDay && e.startsAt.slice(0, 10) === invite.startsAt.slice(0, 10) : !e.allDay && Date.parse(e.startsAt) === Date.parse(invite.startsAt)));
  const byTitle = sameStart.filter((e) => norm(e.title) === norm(invite.title));
  if (byTitle.length >= 1) return byTitle[0];
  const byOrganizer = sameStart.filter((e) => !!invite.organizer && e.organizer?.email === invite.organizer);
  return byOrganizer.length === 1 ? byOrganizer[0] : null;
}

/** When the invitation is, for its card: "Thursday 5 November, 14:00 to 15:00", or the day alone for an all-day one. `timeZone` is the viewer's (the browser's when left out). */
export function inviteWhen(invite: Invite, timeZone?: string): string {
  if (invite.allDay) {
    return new Date(invite.startsAt).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  }
  const day = new Date(invite.startsAt).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone });
  const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });
  return `${day}, ${clock(invite.startsAt)}${invite.endsAt ? ` to ${clock(invite.endsAt)}` : ""}`;
}
