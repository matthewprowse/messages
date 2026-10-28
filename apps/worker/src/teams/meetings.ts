// Which of your Outlook Calendar events were Teams meetings, when to look for their transcripts, and who
// was in them. A transcript appears in Graph a while after the meeting ends, sometimes hours, so a meeting
// is checked again and again until one turns up or GIVE_UP_MS has passed. Pure, so it can be unit tested.

import { graphTimestamp, type GraphEvent } from "../microsoft/calendar-event";
import type { TranscriptSegment } from "./vtt";

/** How long after a meeting ends its transcript is still looked for. */
export const GIVE_UP_MS = 6 * 60 * 60_000;
/** Checked this often in the first two hours after the meeting, when most transcripts land. */
const SOON_EVERY_MS = 10 * 60_000;
const SOON_FOR_MS = 2 * 60 * 60_000;
/** And this often after that. */
const LATER_EVERY_MS = 30 * 60_000;
/** A transcript belongs to an occurrence when it started this close to it: people join early and run late. */
const EARLY_MS = 60 * 60_000;
const LATE_MS = 3 * 60 * 60_000;

export interface MeetingEvent extends GraphEvent {
  isOnlineMeeting?: boolean;
  onlineMeetingProvider?: string | null;
  onlineMeeting?: { joinUrl?: string | null } | null;
  responseStatus?: { response?: string | null } | null;
}

export interface MeetingPerson {
  name: string | null;
  email: string | null;
  self: boolean;
}

/** A Teams meeting from your calendar, one occurrence of it for a repeating one. */
export interface TeamsMeeting {
  /** The calendar event's ID, which tells the occurrences of a repeating meeting apart. */
  eventId: string;
  icalUid: string | null;
  title: string | null;
  startedAt: number;
  endedAt: number;
  joinUrl: string;
  people: MeetingPerson[];
}

/**
 * Your Teams meetings among these calendar events that have started by `now`. Cancelled ones, ones you
 * declined, all-day events and other platforms' meetings are left out.
 */
export function teamsMeetings(events: MeetingEvent[], now: number, self: { name: string | null; addresses: Set<string> }): TeamsMeeting[] {
  const out: TeamsMeeting[] = [];
  for (const event of events) {
    const joinUrl = event.onlineMeeting?.joinUrl?.trim();
    if (!event.id || !joinUrl || event.isCancelled || event.isAllDay || !event.isOnlineMeeting) continue;
    const teams = event.onlineMeetingProvider ? event.onlineMeetingProvider === "teamsForBusiness" : /^https:\/\/teams\.microsoft\.com\//i.test(joinUrl);
    if (!teams || event.responseStatus?.response === "declined") continue;
    const start = Date.parse(graphTimestamp(event.start, false) ?? "");
    const end = Date.parse(graphTimestamp(event.end, false) ?? "");
    if (!Number.isFinite(start) || start > now) continue;
    out.push({
      eventId: event.id,
      icalUid: event.iCalUId ?? null,
      title: event.subject?.trim() || null,
      startedAt: start,
      endedAt: Number.isFinite(end) && end >= start ? end : start,
      joinUrl,
      people: meetingPeople(event, self),
    });
  }
  return out;
}

/** The organiser and attendees, each once, you marked as you. You are added when the invitation left you out. */
export function meetingPeople(event: MeetingEvent, self: { name: string | null; addresses: Set<string> }): MeetingPerson[] {
  const byEmail = new Map<string, MeetingPerson>();
  const add = (name: string | null | undefined, address: string | null | undefined) => {
    const email = address?.trim().toLowerCase();
    if (!email || !email.includes("@") || byEmail.has(email)) return;
    byEmail.set(email, { name: name?.trim() || null, email, self: self.addresses.has(email) });
  };
  add(event.organizer?.emailAddress?.name, event.organizer?.emailAddress?.address);
  for (const a of event.attendees ?? []) if (a.type !== "resource") add(a.emailAddress?.name, a.emailAddress?.address);
  const people = [...byEmail.values()];
  if (!people.some((p) => p.self)) {
    const email = [...self.addresses][0] ?? null;
    people.push({ name: self.name, email, self: true });
  }
  return people;
}

/** Graph's filter for the online meeting behind a join link. */
export function joinUrlFilter(joinUrl: string): string {
  return `JoinWebUrl eq '${joinUrl.replace(/'/g, "''")}'`;
}

export interface CallTranscript {
  id: string;
  createdDateTime?: string | null;
  endDateTime?: string | null;
}

/**
 * The transcripts of one occurrence, oldest first. A repeating meeting keeps every occurrence's transcripts
 * under one online meeting, so they are told apart by when they started. `finished` is false while one of
 * them is still being written.
 */
export function transcriptsFor(list: CallTranscript[], meeting: { startedAt: number; endedAt: number }): { transcripts: CallTranscript[]; finished: boolean } {
  const transcripts = list
    .filter((t) => {
      const at = Date.parse(t.createdDateTime ?? "");
      return Number.isFinite(at) && at >= meeting.startedAt - EARLY_MS && at <= meeting.endedAt + LATE_MS;
    })
    .sort((a, b) => Date.parse(a.createdDateTime!) - Date.parse(b.createdDateTime!));
  return { transcripts, finished: transcripts.every((t) => !!t.endDateTime) };
}

/** Whether a meeting waiting for its transcript should be checked now. Never before it ends. */
export function transcriptCheckDue(endedAt: number, now: number, lastCheck: number | undefined): boolean {
  if (now < endedAt) return false;
  if (lastCheck === undefined) return true;
  const every = now - endedAt < SOON_FOR_MS ? SOON_EVERY_MS : LATER_EVERY_MS;
  return now - lastCheck >= every;
}

/** Whether a meeting has waited long enough to say it has no transcript. */
export function gaveUp(endedAt: number, now: number): boolean {
  return now - endedAt > GIVE_UP_MS;
}

const nameKey = (name: string) => name.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** Speakers in a transcript who are not among these names yet, in the order they first spoke. */
export function newSpeakers(segments: TranscriptSegment[], known: (string | null)[]): string[] {
  const seen = new Set(known.filter((n): n is string => !!n).map(nameKey));
  const out: string[] = [];
  for (const s of segments) {
    if (!s.speaker || seen.has(nameKey(s.speaker))) continue;
    seen.add(nameKey(s.speaker));
    out.push(s.speaker);
  }
  return out;
}
