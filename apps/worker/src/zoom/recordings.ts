import { randomUUID } from "node:crypto";
import type { Json, TablesInsert, TablesUpdate } from "@messages/db";
import { FIELD, type Field } from "@messages/crypto/fields";
import { errorCode, log } from "../log";
import { meetingUuidPath, rateLimited, ZoomApiError, type ZoomApi } from "./client";
import { parseVtt } from "./vtt";

// Zoom meetings with their transcripts, from your cloud recordings. Each poll lists the recordings in a window
// of days and stores one meetings row per meeting: with Zoom's own transcript (a VTT file) when it has one,
// else with the audio recording uploaded for the AI worker to transcribe, else marked as having none. Who
// was there comes from the past meeting participants API. Cloud recording needs a paid Zoom plan, and the
// audio transcript is a setting you turn on in Zoom (Settings, Recording, Create Audio Transcript).
//
// The database and sealing come in through interfaces, so the whole sync can be unit tested on recorded
// Zoom replies (recordings.test.ts).

/** Zoom allows at most a month between from and to. */
const WINDOW_DAYS = 30;
const PAGE_SIZE = 300;
/** After a meeting ends, how long Zoom may still be making its transcript before the audio is used instead. */
export const TRANSCRIPT_GRACE_MS = 2 * 60 * 60_000;
/** The largest recording uploaded for transcribing: Supabase's default upload limit. */
export const MAX_RECORDING_BYTES = 50 * 1024 * 1024;
/** The private bucket recordings are uploaded to, at <user id>/meetings/<meeting id>/<uuid>. */
export const RECORDINGS_BUCKET = "attachments";

export interface ZoomRecordingFile {
  id?: string;
  file_type?: string;
  file_extension?: string;
  file_size?: number;
  download_url?: string;
  /** "completed", or "processing" while Zoom is still making it. */
  status?: string;
  recording_type?: string;
  recording_start?: string;
  recording_end?: string;
}

export interface ZoomRecordingMeeting {
  /** One meeting instance. A recurring meeting's instances share its id but each has its own uuid. */
  uuid: string;
  id: number;
  topic?: string;
  start_time: string;
  /** Minutes. */
  duration?: number;
  recording_files?: ZoomRecordingFile[];
}

interface RecordingsPage {
  meetings?: ZoomRecordingMeeting[];
  next_page_token?: string;
}

interface ParticipantsPage {
  participants?: { id?: string; user_id?: string; name?: string; user_email?: string }[];
  next_page_token?: string;
}

/** What to store for a meeting, from its recording files. */
export type MeetingPlan =
  | { kind: "transcript"; file: ZoomRecordingFile }
  | { kind: "audio"; file: ZoomRecordingFile }
  | { kind: "wait" }
  | { kind: "too_large" }
  | { kind: "none" };

/** When a meeting ended: its last recording file's end, else its start plus its length. */
export function meetingEnd(meeting: ZoomRecordingMeeting): Date {
  const ends = (meeting.recording_files ?? []).map((f) => Date.parse(f.recording_end ?? "")).filter(Number.isFinite);
  if (ends.length) return new Date(Math.max(...ends));
  return new Date(Date.parse(meeting.start_time) + (meeting.duration ?? 0) * 60_000);
}

export function planMeeting(meeting: ZoomRecordingMeeting, now: number): MeetingPlan {
  const files = meeting.recording_files ?? [];
  const done = (f: ZoomRecordingFile) => (f.status ?? "completed") === "completed" && !!f.download_url;
  const transcript = files.find((f) => f.file_type === "TRANSCRIPT" || f.recording_type === "audio_transcript");
  if (transcript && done(transcript)) return { kind: "transcript", file: transcript };
  // Zoom makes the transcript after the recording: wait for it while it is on its way.
  if (transcript || now - meetingEnd(meeting).getTime() < TRANSCRIPT_GRACE_MS) return { kind: "wait" };
  const audio = files.find((f) => f.file_type === "M4A" || f.recording_type === "audio_only");
  if (audio && !done(audio)) return { kind: "wait" };
  if (audio) return (audio.file_size ?? 0) > MAX_RECORDING_BYTES ? { kind: "too_large" } : { kind: "audio", file: audio };
  return { kind: "none" };
}

/** A stored meeting, as much as the sync needs to know whether it is finished. */
export interface StoredMeeting {
  id: string;
  status: string;
  provider_meta: Json;
}

export interface MeetingStore {
  /** The stored meetings among these Zoom meeting UUIDs, by UUID. */
  find(uuids: string[]): Promise<Map<string, StoredMeeting>>;
  /** Creates or updates the meeting by its UUID and returns its id. */
  save(row: TablesInsert<"meetings">): Promise<string>;
  update(id: string, patch: TablesUpdate<"meetings">): Promise<void>;
  hasParticipants(meetingId: string): Promise<boolean>;
  addParticipants(rows: TablesInsert<"meeting_participants">[]): Promise<void>;
  upload(path: string, bytes: Buffer, contentType: string): Promise<void>;
}

/** Sealing for stored text and addresses (vault.ts in the worker). */
export interface Sealer {
  seal(field: Field, value: string | null): Promise<string | null>;
  sealAddress(value: string | null): Promise<string | null>;
}

export interface RecordingSyncContext {
  userId: string;
  accountId: string;
  /** Your Zoom user ID and email, to mark you among the participants. */
  selfId: string;
  selfEmail: string;
  /** Whether the sign-in can read a meeting's details (its join link) and its participants. */
  canReadMeeting: boolean;
  canReadParticipants: boolean;
  now?: () => number;
}

interface ZoomMeetingMeta {
  uuid: string;
  meeting_id: number;
  join_url: string | null;
  recording?: { storage_path: string; mime_type: string };
}

/** A day as Zoom's from and to take it. */
const day = (d: Date) => d.toISOString().slice(0, 10);

export class RecordingSync {
  constructor(
    private readonly api: ZoomApi,
    private readonly store: MeetingStore,
    private readonly sealer: Sealer,
    private readonly ctx: RecordingSyncContext,
  ) {}

  private now() {
    return this.ctx.now?.() ?? Date.now();
  }

  /** Every recorded meeting from `from` to today, a month at a time. Returns how many meetings were stored or updated. */
  async sync(from: Date): Promise<number> {
    const end = new Date(this.now() + 86_400_000); // tomorrow, so a meeting late today in UTC+2 is in range
    let stored = 0;
    for (let start = from; start < end; start = new Date(start.getTime() + WINDOW_DAYS * 86_400_000)) {
      const stop = new Date(Math.min(end.getTime(), start.getTime() + (WINDOW_DAYS - 1) * 86_400_000));
      const meetings = await this.list(start, stop);
      stored += await this.storeAll(meetings);
    }
    return stored;
  }

  private async list(from: Date, to: Date): Promise<ZoomRecordingMeeting[]> {
    const meetings: ZoomRecordingMeeting[] = [];
    let token: string | undefined;
    do {
      const page: RecordingsPage = await this.api.request("/users/me/recordings", {
        query: { from: day(from), to: day(to), page_size: PAGE_SIZE, next_page_token: token },
      });
      meetings.push(...(page.meetings ?? []).filter((m) => m.uuid && m.start_time));
      token = page.next_page_token || undefined;
    } while (token);
    return meetings;
  }

  private async storeAll(meetings: ZoomRecordingMeeting[]): Promise<number> {
    if (meetings.length === 0) return 0;
    const known = await this.store.find([...new Set(meetings.map((m) => m.uuid))]);
    let stored = 0;
    for (const meeting of meetings) {
      const existing = known.get(meeting.uuid);
      // Finished, or its recording is already with the AI worker.
      if (existing && (existing.status !== "waiting" || (existing.provider_meta as unknown as ZoomMeetingMeta | null)?.recording)) continue;
      try {
        if (await this.storeMeeting(meeting, existing)) stored++;
      } catch (err) {
        if (rateLimited(err)) throw err; // the whole sync backs off
        log.warn("zoom meeting failed", { account: this.ctx.accountId, code: errorCode(err) });
      }
    }
    return stored;
  }

  /** Stores one meeting as its recording files allow. Returns false when nothing changed. */
  private async storeMeeting(meeting: ZoomRecordingMeeting, existing: StoredMeeting | undefined): Promise<boolean> {
    const plan = planMeeting(meeting, this.now());
    if (plan.kind === "wait" && existing) return false; // still waiting: look again next time

    const before = existing?.provider_meta as unknown as ZoomMeetingMeta | undefined;
    const meta: ZoomMeetingMeta = {
      uuid: meeting.uuid,
      meeting_id: meeting.id,
      join_url: before?.join_url ?? (await this.joinUrl(meeting.id)),
    };
    const row: TablesInsert<"meetings"> = {
      user_id: this.ctx.userId,
      account_id: this.ctx.accountId,
      platform: "zoom",
      provider_meeting_id: meeting.uuid,
      title: await this.sealer.seal(FIELD.meetingTitle, meeting.topic?.trim() || null),
      started_at: new Date(meeting.start_time).toISOString(),
      ended_at: meetingEnd(meeting).toISOString(),
      status: "waiting",
      error: null,
      provider_meta: meta as unknown as Json,
    };

    if (plan.kind === "transcript") {
      const vtt = (await this.api.download(plan.file.download_url!)).toString("utf8");
      const segments = parseVtt(vtt);
      if (segments.length > 0) {
        Object.assign(row, { status: "transcribed", transcript_source: "provider", transcript: await this.sealer.seal(FIELD.transcript, JSON.stringify(segments)) });
      } else {
        row.status = "no_transcript";
      }
    } else if (plan.kind === "none") {
      row.status = "no_transcript";
    } else if (plan.kind === "too_large") {
      Object.assign(row, { status: "failed", error: "The recording is too long to transcribe." });
    }

    const id = await this.store.save(row);
    if (plan.kind === "audio") await this.uploadAudio(id, plan.file, meta);
    await this.saveParticipants(id, meeting.uuid);
    return true;
  }

  /** Uploads the audio for the AI worker, which transcribes meetings whose provider_meta names a recording. */
  private async uploadAudio(meetingId: string, file: ZoomRecordingFile, meta: ZoomMeetingMeta) {
    const bytes = await this.api.download(file.download_url!);
    if (bytes.length > MAX_RECORDING_BYTES) {
      await this.store.update(meetingId, { status: "failed", error: "The recording is too long to transcribe." });
      return;
    }
    const recording = { storage_path: `${this.ctx.userId}/meetings/${meetingId}/${randomUUID()}`, mime_type: "audio/mp4" };
    await this.store.upload(recording.storage_path, bytes, recording.mime_type);
    await this.store.update(meetingId, { status: "waiting", transcript_source: "recording", provider_meta: { ...meta, recording } as unknown as Json });
  }

  /** The meeting's join link, for matching it to its calendar event. Null when Zoom no longer has the meeting. */
  private async joinUrl(meetingId: number): Promise<string | null> {
    if (!this.ctx.canReadMeeting) return null;
    try {
      const meeting = await this.api.request<{ join_url?: string }>(`/meetings/${meetingId}`);
      return meeting?.join_url ?? null;
    } catch (err) {
      if (rateLimited(err)) throw err;
      // An instant meeting, or one that was deleted, is gone once it ends (404, Zoom code 3001).
      if (!(err instanceof ZoomApiError && (err.status === 404 || err.status === 400))) {
        log.warn("zoom meeting details failed", { account: this.ctx.accountId, code: errorCode(err) });
      }
      return null;
    }
  }

  /** Who was in the meeting, once per meeting, with you marked. Each person once, however often they rejoined. */
  private async saveParticipants(meetingId: string, uuid: string) {
    if (!this.ctx.canReadParticipants || (await this.store.hasParticipants(meetingId))) return;
    const people = new Map<string, { name: string | null; email: string | null; self: boolean }>();
    let token: string | undefined;
    try {
      do {
        const page: ParticipantsPage = await this.api.request(`/past_meetings/${meetingUuidPath(uuid)}/participants`, {
          query: { page_size: PAGE_SIZE, next_page_token: token },
        });
        for (const p of page.participants ?? []) {
          const email = p.user_email?.trim().toLowerCase() || null;
          const name = p.name?.trim() || null;
          const key = email ?? (name ? `name:${name}` : null);
          if (!key) continue;
          const self = (!!email && email === this.ctx.selfEmail.toLowerCase()) || (!!p.id && p.id === this.ctx.selfId);
          const known = people.get(key);
          people.set(key, { name: known?.name ?? name, email, self: self || !!known?.self });
        }
        token = page.next_page_token || undefined;
      } while (token);
    } catch (err) {
      if (rateLimited(err)) throw err;
      log.warn("zoom participants failed", { account: this.ctx.accountId, code: errorCode(err) });
      return;
    }
    if (people.size === 0) return;
    const rows: TablesInsert<"meeting_participants">[] = [];
    for (const p of people.values()) {
      rows.push({
        meeting_id: meetingId,
        user_id: this.ctx.userId,
        name: await this.sealer.seal(FIELD.name, p.name),
        address: await this.sealer.sealAddress(p.email),
        is_self: p.self,
      });
    }
    await this.store.addParticipants(rows);
  }
}
