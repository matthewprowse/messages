// Meetings from Teams, Zoom and Google Meet as the meeting cards need them. The platform connectors store
// them, the sync worker ties their people to contacts and the meeting to its calendar event
// (apps/worker/src/meetings), and the AI worker transcribes recordings and writes the summary and action
// items (apps/ai/ai/meetings.py). The transcript, which can be long, is fetched only when it is opened.

import { FIELD } from "@messages/crypto/fields";
import type { Tables } from "@messages/db";
import { supabase } from "./supabase";
import { open, openRows } from "./vault";
import { parseActions, parseTranscript, type Meeting, type MeetingPlatform, type MeetingStatus, type TranscriptSegment } from "./meeting-text";

export * from "./meeting-text";

const COLUMNS = "id, platform, title, started_at, ended_at, status, error, summary, action_items, calendar_event_id, transcript_source, meeting_participants(name, contact_id, is_self)";
const LIMIT = 200;

type Row = Pick<Tables<"meetings">, "id" | "platform" | "title" | "started_at" | "ended_at" | "status" | "error" | "summary" | "action_items" | "calendar_event_id" | "transcript_source"> & {
  meeting_participants: Pick<Tables<"meeting_participants">, "name" | "contact_id" | "is_self">[];
};

export function mapMeeting(row: Row): Meeting {
  return {
    id: row.id,
    platform: row.platform as MeetingPlatform,
    title: row.title?.trim() || "",
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status as MeetingStatus,
    error: row.error,
    summary: row.summary?.trim() || null,
    actionItems: parseActions(row.action_items),
    calendarEventId: row.calendar_event_id,
    transcriptSource: (row.transcript_source as Meeting["transcriptSource"]) ?? null,
    people: row.meeting_participants.map((p) => ({ name: p.name?.trim() || "", contactId: p.contact_id, isSelf: p.is_self })),
  };
}

async function toMeetings(rows: Row[]): Promise<Meeting[]> {
  await Promise.all([
    openRows(rows, [["title", FIELD.meetingTitle], ["summary", FIELD.summary], ["action_items", FIELD.meetingActions]] as const),
    openRows(rows.flatMap((r) => r.meeting_participants), [["name", FIELD.name]] as const),
  ]);
  return rows.map(mapMeeting);
}

/** Meetings that any of these contacts was in, newest first. */
export async function loadMeetingsWith(contactIds: string[]): Promise<Meeting[]> {
  if (contactIds.length === 0) return [];
  const { data: links, error: linkError } = await supabase.from("meeting_participants").select("meeting_id").in("contact_id", contactIds).limit(1000);
  if (linkError) throw new Error(`Load meetings failed (${linkError.code})`);
  const ids = [...new Set(links.map((l) => l.meeting_id))];
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("meetings").select(COLUMNS).in("id", ids.slice(0, LIMIT)).order("started_at", { ascending: false });
  if (error) throw new Error(`Load meetings failed (${error.code})`);
  return toMeetings(data as unknown as Row[]);
}

/** The meetings held for a calendar event: usually one, more for a call that dropped and was joined again. */
export async function loadMeetingsForEvent(eventId: string): Promise<Meeting[]> {
  const { data, error } = await supabase.from("meetings").select(COLUMNS).eq("calendar_event_id", eventId).order("started_at", { ascending: false }).limit(20);
  if (error) throw new Error(`Load meetings failed (${error.code})`);
  return toMeetings(data as unknown as Row[]);
}

/** A meeting's transcript, opened. Empty when it has none. */
export async function loadTranscript(meetingId: string): Promise<TranscriptSegment[]> {
  const { data, error } = await supabase.from("meetings").select("transcript").eq("id", meetingId).maybeSingle();
  if (error) throw new Error(`Load transcript failed (${error.code})`);
  return parseTranscript(await open(FIELD.transcript, data?.transcript));
}
