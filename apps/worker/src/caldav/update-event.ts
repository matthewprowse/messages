// Changing an event in iCloud: the event's file is read, its VEVENT rewritten with the same UID and a higher
// SEQUENCE, and put back only if nobody changed it in between (If-Match with the etag it was read at). A change
// to one occurrence of a repeating event is an override VEVENT with its own RECURRENCE-ID; a change to the whole
// series edits the series' own VEVENT. Answering an invitation changes the PARTSTAT of your own ATTENDEE line,
// which iCloud tells the organizer about. Pure, so it can be unit tested.

import { allDayRange, validTimeZone } from "../calendar/create-event";
import { ONLY_ORGANIZER, NOT_A_GUEST, seriesShift, wallMs, wallString, type Change, type ChangeTime, type SeriesShift } from "../calendar/update-event";
import type { StoredCalendarEvent } from "../calendar/delete-event";
import { SERIES_RULE } from "../calendar/recurrence";
import { fold } from "./create-event";
import { exceptionLine } from "./delete-event";
import { icsTimestamp, parseLine } from "./ical";

/** Text as iCalendar wants it: backslash, semicolon, comma and line breaks escaped. */
export function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

const PARTSTAT = { accepted: "ACCEPTED", tentative: "TENTATIVE", declined: "DECLINED" } as const;

/** 20261024T080000Z */
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
/** 20261024T080000 */
const wall = (ms: number) => wallString(ms).replace(/[-:]/g, "");
const day = (date: string) => date.replace(/-/g, "");

export interface IcsUpdate {
  change: Change;
  /** The occurrence being changed, as stored. */
  occurrence: { recurrenceId: string | null; startsAt: string; endsAt: string | null; allDay: boolean };
  /** Your addresses, which says which ATTENDEE line is you. */
  selfAddresses: Set<string>;
  /** The address invitations come from, needed only to give an event without guests its first. */
  organizer: string | null;
  now?: Date;
}

type Block = string[];
type Segment = { raw: string[] } | { event: Block };

interface Prop {
  name: string;
  params: string[];
  value: string;
}

/** A line as its name, raw parameters ("K=V") and value, split at the first colon outside quotes. */
function splitLine(line: string): Prop | null {
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
  return { name: parts[0].toUpperCase(), params: parts.slice(1), value: line.slice(colon + 1) };
}

const joinLine = (p: Prop) => [p.name, ...p.params].join(";") + ":" + p.value;
const paramName = (param: string) => param.split("=")[0].toUpperCase();
const paramValue = (p: Prop, name: string) => p.params.find((x) => paramName(x) === name)?.slice(name.length + 1).replace(/^"|"$/g, "");

/** A line with one parameter set, or removed when value is null. */
export function withParam(line: string, name: string, value: string | null): string {
  const p = splitLine(line);
  if (!p) return line;
  const at = p.params.findIndex((x) => paramName(x) === name);
  if (value === null) {
    if (at >= 0) p.params.splice(at, 1);
  } else if (at >= 0) p.params[at] = `${name}=${value}`;
  else p.params.push(`${name}=${value}`);
  return joinLine(p);
}

const emailOf = (p: Prop | null) => {
  const m = /^mailto:(.+)$/i.exec(p?.value.trim() ?? "");
  return m?.[1].includes("@") ? m[1].trim().toLowerCase() : null;
};

/** The indexes of a block's own lines: the ones that are not inside a nested component such as an alarm. */
function ownLines(block: Block): number[] {
  const out: number[] = [];
  let depth = 0;
  for (let i = 1; i < block.length - 1; i++) {
    const upper = block[i].toUpperCase();
    if (upper.startsWith("BEGIN:")) depth++;
    else if (upper.startsWith("END:")) depth--;
    else if (depth === 0) out.push(i);
  }
  return out;
}

const propsOf = (block: Block, name: string) => ownLines(block).filter((i) => splitLine(block[i])?.name === name);
const firstProp = (block: Block, name: string): Prop | null => {
  const at = propsOf(block, name)[0];
  return at === undefined ? null : splitLine(block[at]);
};

function removeProps(block: Block, ...names: string[]): Block {
  const drop = new Set(ownLines(block).filter((i) => names.includes(splitLine(block[i])?.name ?? "")));
  return block.filter((_, i) => !drop.has(i));
}

/** Adds lines with the block's other properties, before any nested component. */
function addLines(block: Block, ...lines: string[]): Block {
  let at = block.length - 1;
  for (let i = 1; i < block.length - 1; i++) {
    if (block[i].toUpperCase().startsWith("BEGIN:")) {
      at = i;
      break;
    }
  }
  return [...block.slice(0, at), ...lines, ...block.slice(at)];
}

const setProp = (block: Block, name: string, line: string | null) => {
  const without = removeProps(block, name);
  return line === null ? without : addLines(without, line);
};

/** Splits an iCalendar file into its VEVENTs and everything around them. */
function segmentsOf(ics: string): Segment[] {
  const lines = ics.replace(/\r?\n[ \t]/g, "").split(/\r?\n/).filter((l) => l !== "");
  const out: Segment[] = [];
  let raw: string[] = [];
  let event: Block | null = null;
  let depth = 0;
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (!event) {
      if (upper === "BEGIN:VEVENT") {
        if (raw.length) out.push({ raw });
        raw = [];
        event = [line];
        depth = 0;
      } else raw.push(line);
      continue;
    }
    event.push(line);
    if (upper.startsWith("BEGIN:")) depth++;
    else if (upper === "END:VEVENT" && depth === 0) {
      out.push({ event });
      event = null;
    } else if (upper.startsWith("END:")) depth--;
  }
  if (raw.length) out.push({ raw });
  return out;
}

const isEvent = (s: Segment): s is { event: Block } => "event" in s;

/** The instant an override's RECURRENCE-ID names, or null. */
function overrideInstant(block: Block): number | null {
  const own = firstProp(block, "RECURRENCE-ID");
  if (!own) return null;
  const at = icsTimestamp(parseLine(joinLine(own)));
  return at ? Date.parse(at.at) : null;
}

/** The time a DTSTART names, and the zone it is written in (UTC for a floating or UTC time). */
function startOf(block: Block): { at: string; allDay: boolean; zone: string | null; raw: Prop } | null {
  const raw = firstProp(block, "DTSTART");
  const at = raw && icsTimestamp(parseLine(joinLine(raw)));
  if (!raw || !at) return null;
  return { at: at.at, allDay: at.allDay, zone: paramValue(raw, "TZID") ?? null, raw };
}

/** The properties that make a VEVENT a series, or an occurrence of one, and so are not copied to an override. */
const SERIES_ONLY = ["RRULE", "RDATE", "EXDATE", "EXRULE", "RECURRENCE-ID", "DTSTART", "DTEND", "DURATION"];

/** An override's RECURRENCE-ID, written in the same form as the series' DTSTART. */
function recurrenceIdLine(master: Block, instant: number, allDay: boolean): string {
  const start = startOf(master);
  if (allDay || start?.allDay) return `RECURRENCE-ID;VALUE=DATE:${day(new Date(instant).toISOString().slice(0, 10))}`;
  if (start?.zone && validTimeZone(start.zone)) return `RECURRENCE-ID;TZID=${start.zone}:${wall(wallMs(new Date(instant), start.zone))}`;
  return `RECURRENCE-ID:${utc(new Date(instant))}`;
}

/** DTSTART and DTEND for an occurrence's own times (an override that is not moved). */
function occurrenceTimeLines(o: IcsUpdate["occurrence"]): string[] {
  if (o.allDay) {
    const lines = [`DTSTART;VALUE=DATE:${day(o.startsAt.slice(0, 10))}`];
    if (o.endsAt) lines.push(`DTEND;VALUE=DATE:${day(o.endsAt.slice(0, 10))}`);
    return lines;
  }
  const lines = [`DTSTART:${utc(new Date(o.startsAt))}`];
  if (o.endsAt) lines.push(`DTEND:${utc(new Date(o.endsAt))}`);
  return lines;
}

/** DTSTART and DTEND for a time chosen in the app, in UTC (or dates for an all-day event). */
function chosenTimeLines(time: ChangeTime): string[] {
  if (time.allDay) {
    const { start, end } = allDayRange(time.startsAt, time.endsAt, time.timeZone);
    return [`DTSTART;VALUE=DATE:${day(start)}`, `DTEND;VALUE=DATE:${day(end)}`];
  }
  return [`DTSTART:${utc(time.startsAt)}`, `DTEND:${utc(time.endsAt)}`];
}

/** The series' own start and end after it moves by `shift`, in the form it is already written in. */
function shiftedTimeLines(master: Block, shift: SeriesShift): string[] | { error: string } {
  const start = startOf(master);
  if (!start) return { error: "This event's start could not be read." };
  if (shift.kind === "date") {
    if (!start.allDay) return { error: "Change one event at a time to switch between all day and timed." };
    const first = Date.parse(`${start.at.slice(0, 10)}T00:00:00Z`) + shift.days * 86_400_000;
    const last = first + shift.length * 86_400_000;
    const date = (ms: number) => day(new Date(ms).toISOString().slice(0, 10));
    return [`DTSTART;VALUE=DATE:${date(first)}`, `DTEND;VALUE=DATE:${date(last)}`];
  }
  if (start.allDay) return { error: "Change one event at a time to switch between all day and timed." };
  const zone = start.zone ?? "UTC";
  if (!validTimeZone(zone)) return { error: "This repeating event uses a time zone that cannot be changed here." };
  const first = wallMs(start.at, zone) + shift.delta;
  const last = first + shift.length;
  if (start.zone) return [`DTSTART;TZID=${zone}:${wall(first)}`, `DTEND;TZID=${zone}:${wall(last)}`];
  return [`DTSTART:${wall(first)}Z`, `DTEND:${wall(last)}Z`];
}

/** Sets who is invited. Yours, the organizer's and rooms stay; the rest are the new list. */
function setGuests(block: Block, wanted: string[], u: IcsUpdate): Block | { error: string } {
  const { selfAddresses } = u;
  const organizer = firstProp(block, "ORGANIZER");
  const organizerEmail = emailOf(organizer);
  if (organizerEmail && !selfAddresses.has(organizerEmail)) return { error: ONLY_ORGANIZER };

  const kept = new Set<string>();
  let out = block;
  const lines = propsOf(block, "ATTENDEE");
  const drop = new Set<number>();
  for (const i of lines) {
    const p = splitLine(block[i])!;
    const email = emailOf(p);
    const room = ["RESOURCE", "ROOM"].includes(paramValue(p, "CUTYPE")?.toUpperCase() ?? "");
    if (email && (selfAddresses.has(email) || email === organizerEmail || room || wanted.includes(email))) kept.add(email);
    else drop.add(i);
  }
  out = out.filter((_, i) => !drop.has(i));

  const add = wanted.filter((e) => !kept.has(e) && !selfAddresses.has(e));
  const lead: string[] = [];
  if (!organizer && (add.length > 0 || wanted.length > 0)) {
    if (!u.organizer) return { error: "iCloud did not say which address to invite from. Remove the guests, or reconnect with pnpm connect:icloud-calendar." };
    lead.push(`ORGANIZER:mailto:${u.organizer}`, `ATTENDEE;PARTSTAT=ACCEPTED:mailto:${u.organizer}`);
    kept.add(u.organizer);
  }
  const agent = u.change.sendInvites ? "" : ";SCHEDULE-AGENT=CLIENT";
  out = addLines(out, ...lead, ...add.map((email) => `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE${agent}:mailto:${email}`));

  // With nobody left but yourself, the event is no longer a meeting.
  if (wanted.length === 0) {
    const people = propsOf(out, "ATTENDEE").filter((i) => !["RESOURCE", "ROOM"].includes(paramValue(splitLine(out[i])!, "CUTYPE")?.toUpperCase() ?? ""));
    if (people.every((i) => selfAddresses.has(emailOf(splitLine(out[i])) ?? ""))) {
      const drops = new Set(people);
      out = removeProps(out.filter((_, i) => !drops.has(i)), "ORGANIZER");
    }
  }
  return out;
}

/** Whether the invitations of this change are sent: guests other than you are told, or marked as not to be. */
function setScheduling(block: Block, u: IcsUpdate): Block {
  return block.map((line, i) => {
    if (!propsOf(block, "ATTENDEE").includes(i)) return line;
    const p = splitLine(line)!;
    if (u.selfAddresses.has(emailOf(p) ?? "") || ["RESOURCE", "ROOM"].includes(paramValue(p, "CUTYPE")?.toUpperCase() ?? "")) return line;
    return withParam(line, "SCHEDULE-AGENT", u.change.sendInvites ? null : "CLIENT");
  });
}

/** Your answer on every ATTENDEE line that is you. Returns null when you are not a guest. */
function setAnswer(block: Block, u: IcsUpdate): Block | null {
  let found = false;
  const mine = new Set(propsOf(block, "ATTENDEE").filter((i) => u.selfAddresses.has(emailOf(splitLine(block[i])) ?? "")));
  const out = block.map((line, i) => {
    if (!mine.has(i)) return line;
    found = true;
    return withParam(line, "PARTSTAT", PARTSTAT[u.change.response!]);
  });
  return found ? out : null;
}

/** Marks a block as changed now: a new DTSTAMP and LAST-MODIFIED, and a higher SEQUENCE when it is not an answer. */
function stamp(block: Block, now: Date, sequence: number | null): Block {
  const stamped = setProp(setProp(block, "DTSTAMP", `DTSTAMP:${utc(now)}`), "LAST-MODIFIED", `LAST-MODIFIED:${utc(now)}`);
  return sequence === null ? stamped : setProp(stamped, "SEQUENCE", `SEQUENCE:${sequence}`);
}

const sequenceOf = (block: Block) => {
  const n = Number(firstProp(block, "SEQUENCE")?.value.trim());
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

/** The details a change sets on one VEVENT. */
function applyDetails(block: Block, u: IcsUpdate, times: string[] | null): Block | { error: string } {
  const { change } = u;
  let out = block;
  if (change.title !== undefined) out = setProp(out, "SUMMARY", `SUMMARY:${escapeText(change.title)}`);
  if (change.location !== undefined) out = setProp(removeProps(out, "X-APPLE-STRUCTURED-LOCATION"), "LOCATION", change.location ? `LOCATION:${escapeText(change.location)}` : null);
  if (change.description !== undefined) out = setProp(out, "DESCRIPTION", change.description ? `DESCRIPTION:${escapeText(change.description)}` : null);
  if (times) out = addLines(removeProps(out, "DTSTART", "DTEND", "DURATION"), ...times);
  if (change.attendees !== undefined) {
    const guests = setGuests(out, change.attendees, u);
    if ("error" in guests) return guests;
    out = guests;
  }
  if (change.attendees !== undefined || propsOf(out, "ATTENDEE").length > 0) out = setScheduling(out, u);
  return out;
}

/**
 * The event's file with the change made, or why it cannot be. `ics` is the file as it is now. An answer to an
 * invitation changes only your PARTSTAT; a change of details also needs you to be the organizer.
 */
export function updateIcs(ics: string, u: IcsUpdate): { ics: string } | { error: string } {
  const now = u.now ?? new Date();
  const segments = segmentsOf(ics);
  const events = segments.filter(isEvent);
  const masterAt = events.findIndex((s) => !firstProp(s.event, "RECURRENCE-ID"));
  if (masterAt < 0) return { error: "This event could not be read." };
  const master = events[masterAt].event;
  const overrides = events.filter((s) => s !== events[masterAt]);
  const repeating = !!firstProp(master, "RRULE") || !!firstProp(master, "RDATE") || overrides.length > 0;
  const { change } = u;
  const whole = change.scope === "series" || !repeating;
  const rsvp = change.kind === "rsvp";
  if (change.recurrence !== undefined && !whole) return { error: SERIES_RULE };

  // An update of details must come from the organizer (or from an event with no guests at all).
  if (!rsvp) {
    const organizerEmail = emailOf(firstProp(master, "ORGANIZER"));
    if (organizerEmail && !u.selfAddresses.has(organizerEmail)) return { error: ONLY_ORGANIZER };
  }

  const replace = new Map<Block, Block>();
  let added: Block | null = null;

  if (whole) {
    // The series' own VEVENT; an answer to the whole series also goes on its changed occurrences.
    let shift: SeriesShift | null = null;
    if (change.time && repeating) {
      const o = u.occurrence;
      const found = seriesShift(change.time, { starts_at: o.startsAt, ends_at: o.endsAt, all_day: o.allDay });
      if ("error" in found) return found;
      shift = found;
    }
    for (const block of rsvp ? events.map((s) => s.event) : [master]) {
      let next: Block;
      if (rsvp) {
        const answered = setAnswer(block, u);
        if (!answered) {
          if (block === master) return { error: NOT_A_GUEST };
          continue;
        }
        next = answered;
      } else {
        let times: string[] | null = null;
        if (change.time) {
          const lines = shift ? shiftedTimeLines(block, shift) : chosenTimeLines(change.time);
          if (!Array.isArray(lines)) return lines;
          times = lines;
        }
        const done = applyDetails(block, u, times);
        if ("error" in done) return done;
        // A new rule replaces the series' own (or makes a single event repeat); skipped dates stay.
        next = change.recurrence !== undefined ? setProp(done, "RRULE", `RRULE:${change.recurrence}`) : done;
      }
      replace.set(block, stamp(next, now, rsvp ? null : sequenceOf(block) + 1));
    }
  } else {
    // One occurrence: its override if it has one, else a new one made from the series.
    const { instant } = exceptionLine(u.occurrence.recurrenceId, u.occurrence.startsAt, u.occurrence.allDay);
    const own = overrides.find((s) => overrideInstant(s.event) === instant)?.event;
    let base: Block;
    if (own) base = own;
    else {
      const stripped = removeProps(master, ...SERIES_ONLY);
      base = [stripped[0], recurrenceIdLine(master, instant, u.occurrence.allDay), ...occurrenceTimeLines(u.occurrence), ...stripped.slice(1)];
    }
    let next: Block;
    if (rsvp) {
      const answered = setAnswer(base, u);
      if (!answered) return { error: NOT_A_GUEST };
      next = answered;
    } else {
      const done = applyDetails(base, u, change.time ? chosenTimeLines(change.time) : null);
      if ("error" in done) return done;
      next = done;
    }
    next = stamp(next, now, rsvp ? null : (own ? sequenceOf(own) : sequenceOf(master)) + 1);
    if (own) replace.set(own, next);
    else added = next;
  }

  const lines: string[] = [];
  let lastEvent = -1;
  const out: Segment[] = segments.map((s) => (isEvent(s) && replace.has(s.event) ? { event: replace.get(s.event)! } : s));
  out.forEach((s, i) => {
    if (isEvent(s)) lastEvent = i;
  });
  if (added) out.splice(lastEvent + 1, 0, { event: added });
  for (const s of out) lines.push(...(isEvent(s) ? s.event : s.raw));
  return { ics: lines.flatMap(fold).join("\r\n") + "\r\n" };
}

/** What a refused change means. */
export function icloudUpdateFailure(status: number | null): string {
  if (status === 401) return "iCloud rejected the sign-in. Run pnpm connect:icloud-calendar to reconnect.";
  if (status === 403) return "You cannot change this event.";
  if (status === 404) return "This event no longer exists.";
  if (status === 412) return "This event was changed somewhere else. Try again.";
  if (status === 429) return "iCloud Calendar is busy. Try again in a minute.";
  if (status === null || status >= 500) return "iCloud Calendar did not respond. Check the event before trying again.";
  return "iCloud Calendar did not accept this change.";
}

/** The occurrence a stored event is: its RECURRENCE-ID (the part of its id after the "#") and its times. */
export function occurrenceOf(event: Pick<StoredCalendarEvent, "provider_event_id" | "starts_at" | "ends_at" | "all_day">): IcsUpdate["occurrence"] {
  return { recurrenceId: event.provider_event_id.split("#")[1] ?? null, startsAt: event.starts_at, endsAt: event.ends_at, allDay: event.all_day };
}
