// The rules for tying a meeting from Teams, Zoom or Google Meet to the rest of the app: who in it is which
// contact (by email address, as calendar guests are), and which calendar event it was. Pure, so the sweep
// in linker.ts stays a matter of loading and saving.

const HOUR_MS = 3_600_000;
/** A join link is shared by every occurrence of a repeating meeting, so the event must also start near it. */
export const LINK_WINDOW_MS = 12 * HOUR_MS;
/** People join a few minutes early or late, so times this close still count as overlapping. */
export const SLACK_MS = 15 * 60_000;
/** How long a meeting with no end time, or an event with none, is taken to last. */
const DEFAULT_LENGTH_MS = 30 * 60_000;

/** An email address as the address index takes it, or null when the value is not one. */
export function participantEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  let v = value.trim();
  const bracketed = v.match(/<([^<>]+)>\s*$/);
  if (bracketed) v = bracketed[1].trim();
  v = v.replace(/^mailto:/i, "").toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

function decoded(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * What identifies a meeting in its join link, so the link in a calendar invite and the one the platform
 * reports compare equal even when they differ in host, query or case: a Zoom meeting's number, a Meet
 * code, a Teams meeting's thread. Any other https link compares by host and path. Null when it is not a link.
 */
export function joinKey(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = decoded(u.pathname);
  // Zoom: us02web.zoom.us/j/123, zoom.us/w/123, zoom.us/wc/123/join, or a personal link zoom.us/my/name.
  if (/(^|\.)zoom(gov)?\.(us|com)$/.test(host)) {
    const id = path.match(/^\/(?:j|w|s|wc)\/(\d{9,12})(?:\/|$)/)?.[1];
    if (id) return `zoom:${id}`;
    const vanity = path.match(/^\/my\/([^/]+)/)?.[1];
    if (vanity) return `zoom:my:${vanity.toLowerCase()}`;
  }
  if (host === "meet.google.com") {
    const code = path.match(/^\/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:\/|$)/i)?.[1];
    if (code) return `meet:${code.toLowerCase()}`;
  }
  // Teams: /l/meetup-join/19:meeting_...@thread.v2/0?context=..., or a newer /meet/<number>?p=... link.
  if (host === "teams.microsoft.com" || host === "teams.live.com" || host.endsWith(".teams.microsoft.com")) {
    const thread = path.match(/\/meetup-join\/([^/]+)/)?.[1];
    if (thread) return `teams:${thread}`;
    const meet = path.match(/^\/meet\/(\d+)/)?.[1];
    if (meet) return `teams:meet:${meet}`;
  }
  return `${host}${path.replace(/\/+$/, "").toLowerCase()}`;
}

export interface MeetingFacts {
  startedAt: string;
  endedAt: string | null;
  /** provider_meta.join_url. */
  joinUrl: string | null;
  /** Everyone in it except you, as lowercase email addresses. */
  emails: string[];
}

export interface EventFacts {
  id: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  conferenceUrl: string | null;
  /** Its guests except you, as lowercase email addresses. */
  emails: string[];
}

function span(start: string, end: string | null): [number, number] {
  const from = Date.parse(start);
  const to = end ? Date.parse(end) : NaN;
  return [from, Number.isFinite(to) && to > from ? to : from + DEFAULT_LENGTH_MS];
}

/**
 * The calendar event a meeting was, or null. First by join link, choosing the occurrence that starts
 * nearest; then by time and people: a timed event that overlaps the meeting (give or take SLACK_MS) and
 * shares at least one guest with it, preferring more shared guests, then more overlap, then the nearer start.
 */
export function matchEvent(meeting: MeetingFacts, events: EventFacts[]): string | null {
  const start = Date.parse(meeting.startedAt);
  if (!Number.isFinite(start)) return null;

  const key = joinKey(meeting.joinUrl);
  if (key) {
    let best: { id: string; gap: number } | null = null;
    for (const e of events) {
      if (joinKey(e.conferenceUrl) !== key) continue;
      const gap = Math.abs(Date.parse(e.startsAt) - start);
      if (!(gap <= LINK_WINDOW_MS)) continue;
      if (!best || gap < best.gap) best = { id: e.id, gap };
    }
    if (best) return best.id;
  }

  const [from, to] = span(meeting.startedAt, meeting.endedAt);
  const people = new Set(meeting.emails.map((e) => e.toLowerCase()));
  if (people.size === 0) return null;
  let best: { id: string; shared: number; overlap: number; gap: number } | null = null;
  for (const e of events) {
    if (e.allDay) continue;
    const [eFrom, eTo] = span(e.startsAt, e.endsAt);
    const overlap = Math.min(to, eTo + SLACK_MS) - Math.max(from, eFrom - SLACK_MS);
    if (!(overlap > 0)) continue;
    const shared = new Set(e.emails.map((x) => x.toLowerCase()).filter((x) => people.has(x))).size;
    if (shared === 0) continue;
    const gap = Math.abs(eFrom - from);
    const better = !best || shared > best.shared || (shared === best.shared && (overlap > best.overlap || (overlap === best.overlap && gap < best.gap)));
    if (better) best = { id: e.id, shared, overlap, gap };
  }
  return best?.id ?? null;
}

type StoredAttendee = { email?: unknown; self?: unknown };

/** A calendar event's guests other than you, from its stored attendees. */
export function eventEmails(attendees: unknown): string[] {
  if (!Array.isArray(attendees)) return [];
  return (attendees as StoredAttendee[])
    .filter((a) => a && typeof a === "object" && typeof a.email === "string" && !a.self)
    .map((a) => participantEmail(a.email as string))
    .filter((e): e is string => !!e);
}
