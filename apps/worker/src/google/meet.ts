// Google Meet through the Meet REST API (meet.googleapis.com/v2), read only: the conference records of
// meetings that have ended, who took part, and what was said as the transcript's entries. This file is
// the pure part, turning Google's resources into what is stored; connectors/google-meet.ts does the calls.
// Transcript entries come from the API itself, so no Drive scope is needed to read the transcript document.

export const MEET_API = "https://meet.googleapis.com/v2";

/** One meeting that took place in a Meet space. `name` is "conferenceRecords/{id}". */
export interface ConferenceRecord {
  name: string;
  startTime?: string;
  /** Unset while the meeting is still going. */
  endTime?: string;
  /** When Google deletes the record, 30 days after it ends. */
  expireTime?: string;
  /** "spaces/{id}" */
  space?: string;
}

export interface MeetSpace {
  name: string;
  /** The join link, e.g. https://meet.google.com/abc-mnop-xyz */
  meetingUri?: string;
  meetingCode?: string;
}

/** Someone who joined. Exactly one of the three kinds is set. */
export interface MeetParticipant {
  /** "conferenceRecords/{id}/participants/{id}", which transcript entries point at. */
  name: string;
  earliestStartTime?: string;
  latestEndTime?: string;
  /** "users/{id}": the same ID as the People API and the OpenID sign-in's sub. */
  signedinUser?: { user?: string; displayName?: string };
  anonymousUser?: { displayName?: string };
  /** A partly hidden phone number. */
  phoneUser?: { displayName?: string };
}

export interface Transcript {
  name: string;
  state?: "STATE_UNSPECIFIED" | "STARTED" | "ENDED" | "FILE_GENERATED";
  startTime?: string;
  endTime?: string;
}

export interface TranscriptEntry {
  name?: string;
  /** The participant's resource name. */
  participant?: string;
  text?: string;
  languageCode?: string;
  startTime?: string;
  endTime?: string;
}

/** One stretch of what was said, as meetings.transcript stores it. */
export interface Segment {
  speaker: string;
  /** From the start of the meeting. */
  start_ms: number;
  text: string;
}

/** Someone from the calendar event this meeting was, as calendar_events.attendees has them. */
export interface Attendee {
  email: string;
  name?: string | null;
  self?: boolean;
}

/** A participant as meeting_participants stores them, before sealing. */
export interface MappedParticipant {
  /** The participant's resource name, for the transcript's speakers. */
  key: string;
  name: string;
  address: string | null;
  isSelf: boolean;
}

/** The name shown for someone Google gives no name for. */
export const NO_NAME = "Someone";
/** Consecutive entries by one speaker are joined into one segment up to about this length. */
const MERGE_CHARS = 1500;
/** A meeting with no transcript yet is checked again for this long after it ends, in case one is still being made. */
export const TRANSCRIPT_GRACE_MS = 30 * 60_000;

/** Ended meetings since `since`, for conferenceRecords.list. Meetings still going have no end time and are left out. */
export function conferenceFilter(since: string): string {
  return `end_time>="${since}"`;
}

/** What a participant is called: their Google name, the name they typed joining as a guest, or their part-hidden number. */
export function participantName(p: MeetParticipant): string {
  const name = p.signedinUser?.displayName ?? p.anonymousUser?.displayName ?? p.phoneUser?.displayName;
  return name?.trim() || NO_NAME;
}

/** The Google user ID in "users/{id}", or null for a guest or a phone. */
export function userIdOf(resource: string | undefined): string | null {
  const id = resource?.match(/^users\/(.+)$/)?.[1];
  return id || null;
}

const sameName = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Who took part, with an email address where one can be found: yours for you (your Google ID is the sign-in's),
 * from Google's directory or contacts by their ID, else from the calendar event's guest list by name. When one
 * signed-in guest and one invited guest are left unmatched, they are the same person. Guests who joined without
 * signing in and phone callers have no address.
 */
export function mapParticipants(
  participants: MeetParticipant[],
  ctx: { selfUserId: string | null; selfEmail: string | null; attendees: Attendee[]; emailsByUser?: Map<string, string> },
): MappedParticipant[] {
  const used = new Set<string>();
  const selfEmail = ctx.selfEmail?.toLowerCase() ?? null;
  if (selfEmail) used.add(selfEmail);
  const invited = ctx.attendees.filter((a) => a.email && !a.self && a.email.toLowerCase() !== selfEmail);

  const mapped = participants.map((p): MappedParticipant & { userId: string | null } => {
    const userId = userIdOf(p.signedinUser?.user);
    const isSelf = !!userId && userId === ctx.selfUserId;
    return { key: p.name, name: participantName(p), address: isSelf ? selfEmail : null, isSelf, userId };
  });

  // By ID first: an address Google itself ties to the person.
  for (const m of mapped) {
    if (m.isSelf || !m.userId) continue;
    const email = ctx.emailsByUser?.get(m.userId)?.toLowerCase();
    if (email && !used.has(email)) {
      m.address = email;
      used.add(email);
    }
  }
  // Then by name against the invitation.
  for (const m of mapped) {
    if (m.address || m.isSelf || !m.userId) continue;
    const match = invited.find((a) => !used.has(a.email.toLowerCase()) && sameName(a.name, m.name));
    if (match) {
      m.address = match.email.toLowerCase();
      used.add(m.address);
    }
  }
  // Then by elimination, the common case of a call with one client.
  const leftPeople = mapped.filter((m) => !m.address && !m.isSelf && m.userId);
  const leftInvited = invited.filter((a) => !used.has(a.email.toLowerCase()));
  if (leftPeople.length === 1 && leftInvited.length === 1) leftPeople[0].address = leftInvited[0].email.toLowerCase();

  return mapped.map(({ userId: _userId, ...m }) => m);
}

/**
 * The transcript entries as meetings.transcript segments, oldest first: who spoke (by the participant the entry
 * names), when from the start of the meeting, and what they said. Consecutive entries by one speaker are joined,
 * so the transcript reads as turns rather than Google's sentence-sized pieces. Empty entries are dropped.
 */
export function entriesToSegments(entries: TranscriptEntry[], ctx: { startedAt: string; speakers: Map<string, string> }): Segment[] {
  const start = Date.parse(ctx.startedAt);
  const sorted = entries
    .map((e, i) => ({ e, i, at: e.startTime ? Date.parse(e.startTime) : NaN }))
    .sort((a, b) => (Number.isFinite(a.at) && Number.isFinite(b.at) ? a.at - b.at : 0) || a.i - b.i);

  const segments: Segment[] = [];
  for (const { e, at } of sorted) {
    const text = e.text?.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const speaker = (e.participant && ctx.speakers.get(e.participant)) || NO_NAME;
    const startMs = Number.isFinite(at) && Number.isFinite(start) ? Math.max(0, at - start) : (segments.at(-1)?.start_ms ?? 0);
    const last = segments.at(-1);
    if (last && last.speaker === speaker && last.text.length + text.length < MERGE_CHARS) {
      last.text += " " + text;
      continue;
    }
    segments.push({ speaker, start_ms: startMs, text });
  }
  return segments;
}

/**
 * Whether a meeting's transcript can be read: "ready" once every transcript session has ended, "waiting" while
 * one is still being written or shortly after the meeting when none has appeared yet, and "none" when
 * transcription was never turned on.
 */
export function transcriptReadiness(transcripts: Transcript[], endedAt: string | undefined, now = Date.now()): "ready" | "waiting" | "none" {
  const ended = endedAt ? Date.parse(endedAt) : NaN;
  const since = Number.isFinite(ended) ? now - ended : Infinity;
  if (transcripts.length === 0) return since < TRANSCRIPT_GRACE_MS ? "waiting" : "none";
  // A session Google still calls started a day after the meeting will not finish: what it has is read.
  return transcripts.some((t) => t.state === "STARTED") && since < STUCK_MS ? "waiting" : "ready";
}

/** How long after a meeting a transcript still being written is waited for. */
const STUCK_MS = 24 * 60 * 60_000;

/** A stored calendar event, as far as finding the one a meeting was goes. */
export interface CalendarEventRef {
  id: string;
  title: string | null;
  starts_at: string;
  conference_url: string | null;
  attendees: unknown;
}

/** How far a meeting's start may be from its event's for them to be the same occasion. */
const EVENT_WINDOW_MS = 12 * 60 * 60_000;

/**
 * The calendar event a meeting was held for, only to borrow its guests' addresses and its title: the one with
 * this meeting's link that starts nearest to when the meeting did. Recurring meetings share a link, hence the time.
 */
export function eventForMeeting<E extends CalendarEventRef>(events: E[], meet: { meetingCode: string | null; startedAt: string }): E | null {
  if (!meet.meetingCode) return null;
  const code = meet.meetingCode.toLowerCase();
  const start = Date.parse(meet.startedAt);
  let best: E | null = null;
  let bestGap = Infinity;
  for (const event of events) {
    if (!event.conference_url?.toLowerCase().includes(code)) continue;
    const gap = Math.abs(Date.parse(event.starts_at) - start);
    if (gap <= EVENT_WINDOW_MS && gap < bestGap) {
      best = event;
      bestGap = gap;
    }
  }
  return best;
}

/** A calendar event's attendees JSON, as a list. Anything malformed is skipped. */
export function attendeesOf(value: unknown): Attendee[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((a) => {
    const row = a as { email?: unknown; name?: unknown; self?: unknown };
    return typeof row?.email === "string" && row.email ? [{ email: row.email, name: typeof row.name === "string" ? row.name : null, self: row.self === true }] : [];
  });
}

/** The meeting code in a Meet link, for matching calendar events, which keep the link as Google Calendar gives it. */
export function meetingCodeOf(space: MeetSpace | null): string | null {
  if (space?.meetingCode) return space.meetingCode;
  return space?.meetingUri?.match(/meet\.google\.com\/([a-z0-9-]+)/i)?.[1] ?? null;
}

/** Shown when recent meetings have all come without a transcript, the sign of a plan without Meet transcription. */
export const NO_TRANSCRIPTS_HINT =
  "None of your recent meetings had a transcript. Transcripts need a Google Workspace plan with Meet transcription, turned on in each meeting.";

/** How many recent meetings without a transcript it takes before saying so. */
export const HINT_AFTER = 3;

/** Whether to show NO_TRANSCRIPTS_HINT, from the statuses of the most recent meetings, newest first. */
export function noTranscriptsLikely(statuses: string[]): boolean {
  const recent = statuses.slice(0, 10);
  return recent.length >= HINT_AFTER && recent.every((s) => s === "no_transcript");
}

/** From the OpenID userinfo endpoint: who signed in, and their Workspace domain when they have one. */
export interface UserInfo {
  sub: string;
  email?: string;
  /** Hosted domain: set only for Google Workspace accounts. */
  hd?: string;
}

/**
 * Whether this is a Google Workspace account, which Meet transcripts and the Chat API both need. A personal
 * account (an @gmail.com address, or a sign-in with no hosted domain) has neither.
 */
export function isWorkspace(info: UserInfo | null, address: string | null): boolean {
  if (info) return !!info.hd;
  return !/@(gmail|googlemail)\.com$/i.test(address ?? "");
}

export const MEET_API_OFF =
  "Google Meet could not be read. Check that the Google Meet REST API is turned on in your Google Cloud project.";
export const MEET_NOT_GRANTED = "Google Meet access was not granted. Reconnect Google in Settings, Connected Accounts, and tick the Meet box.";

/** Why Meet refused to be read, when retrying soon will not help, or null. */
export function meetReadProblem(status: number, reason: string | null): string | null {
  if (status === 403 && reason === "insufficientPermissions") return MEET_NOT_GRANTED;
  if (status === 403) return MEET_API_OFF;
  return null;
}

export const PERSONAL_ACCOUNT =
  "Meet transcripts and Google Chat need a Google Workspace account. This is a personal Google account, which has neither. Connect a Workspace account instead.";
