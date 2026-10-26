// The text side of meetings, kept apart from loading them (meetings.ts) so it can be tested on its own: the
// stored transcript and action items read back, a meeting's length, and searching a transcript.

export type MeetingPlatform = "teams" | "zoom" | "google_meet";
export type MeetingStatus = "waiting" | "transcribed" | "summarised" | "no_transcript" | "failed";

export interface MeetingPerson {
  name: string;
  /** The contact they were matched to, by email address. */
  contactId: string | null;
  isSelf: boolean;
}

export interface Meeting {
  id: string;
  platform: MeetingPlatform;
  title: string;
  startedAt: string;
  endedAt: string | null;
  status: MeetingStatus;
  /** Why it failed, when it did. */
  error: string | null;
  summary: string | null;
  actionItems: string[];
  calendarEventId: string | null;
  /** Where the transcript came from, once there is one or one is on its way. */
  transcriptSource: "provider" | "recording" | null;
  people: MeetingPerson[];
}

export interface TranscriptSegment {
  speaker: string;
  startMs: number;
  text: string;
}

/** Action items as stored: JSON text of a list of strings. Anything else reads as none. */
export function parseActions(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const list = JSON.parse(value) as unknown;
    return Array.isArray(list) ? list.filter((a): a is string => typeof a === "string" && a.trim().length > 0).map((a) => a.trim()) : [];
  } catch {
    return [];
  }
}

/** A transcript as stored: JSON text of segments, oldest first. Plain text reads as one segment with no speaker. */
export function parseTranscript(value: string | null | undefined): TranscriptSegment[] {
  if (!value?.trim()) return [];
  let data: unknown;
  try {
    data = JSON.parse(value);
  } catch {
    return [{ speaker: "", startMs: 0, text: value.trim() }];
  }
  if (!Array.isArray(data)) return [];
  return data.flatMap((s) => {
    if (!s || typeof s !== "object") return [];
    const { speaker, start_ms, text } = s as { speaker?: unknown; start_ms?: unknown; text?: unknown };
    if (typeof text !== "string" || !text.trim()) return [];
    return [{ speaker: typeof speaker === "string" ? speaker.trim() : "", startMs: typeof start_ms === "number" && start_ms >= 0 ? start_ms : 0, text: text.trim() }];
  });
}

/** Whether a meeting has a transcript to read (or may have, after a summary that failed). */
export function hasTranscript(m: Pick<Meeting, "status" | "transcriptSource">): boolean {
  return m.status === "transcribed" || m.status === "summarised" || (m.status === "failed" && m.transcriptSource === "provider");
}

/** How long a meeting ran, such as "45 min" or "1 hr 5 min". Null when it has no end yet. */
export function meetingLength(startedAt: string, endedAt: string | null): string | null {
  if (!endedAt) return null;
  const mins = Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 60_000);
  if (!Number.isFinite(mins) || mins < 0) return null;
  if (mins < 1) return "Under a minute";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? (m ? `${h} hr ${m} min` : `${h} hr`) : `${m} min`;
}

/** Where a segment starts, as H:MM:SS or M:SS. */
export function segmentTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** The segments that contain every word searched for, in what was said or who said it. Blank finds them all. */
export function searchTranscript(segments: TranscriptSegment[], query: string): TranscriptSegment[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return segments;
  return segments.filter((s) => {
    const hay = `${s.speaker} ${s.text}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/**
 * A segment's text split around the words searched for, so they can be marked. Matches are found in the
 * lowercased text, so the pieces keep the original's case.
 */
export function highlight(text: string, query: string): { text: string; hit: boolean }[] {
  const words = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];
  if (words.length === 0) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const marks = new Array<boolean>(text.length).fill(false);
  for (const w of words) {
    for (let i = lower.indexOf(w); i !== -1; i = lower.indexOf(w, i + w.length)) marks.fill(true, i, i + w.length);
  }
  const out: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = out[out.length - 1];
    if (last && last.hit === marks[i]) last.text += text[i];
    else out.push({ text: text[i], hit: marks[i] });
  }
  return out;
}

/** The meetings to place among a conversation's messages: from its first loaded message on, or all once every message is loaded. */
export function meetingsAmong<T extends { startedAt: string }>(meetings: T[], firstSentAt: string | undefined, allLoaded: boolean): T[] {
  if (!firstSentAt) return [];
  const from = Date.parse(firstSentAt);
  return meetings.filter((m) => allLoaded || Date.parse(m.startedAt) >= from).sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}
