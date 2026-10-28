// The recordings sync on hand-written replies shaped like Zoom's (GET /users/me/recordings, GET /meetings/{id},
// GET /past_meetings/{uuid}/participants), with an in-memory store in place of the database.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { TablesInsert, TablesUpdate } from "@messages/db";
import { ZoomApiError, type ZoomApi, type ZoomRequest } from "./client";
import { MAX_RECORDING_BYTES, RecordingSync, TRANSCRIPT_GRACE_MS, planMeeting, type MeetingStore, type StoredMeeting, type ZoomRecordingFile, type ZoomRecordingMeeting } from "./recordings";

const NOW = Date.parse("2026-10-26T12:00:00Z");
const HOUR = 60 * 60_000;

const VTT = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nThandi Nkosi: Thanks for joining.\n\n2\n00:00:04.000 --> 00:00:06.000\nPieter van Wyk: Happy to.\n";

function meeting(uuid: string, files: ZoomRecordingMeeting["recording_files"], startedHoursAgo = 24): ZoomRecordingMeeting {
  const start = new Date(NOW - startedHoursAgo * HOUR);
  return {
    uuid,
    id: 81234567890,
    topic: "Offer review",
    start_time: start.toISOString(),
    duration: 30,
    recording_files: files?.map((f) => ({ recording_start: start.toISOString(), recording_end: new Date(start.getTime() + 30 * 60_000).toISOString(), ...f })),
  };
}

const transcriptFile = { id: "t1", file_type: "TRANSCRIPT", file_extension: "VTT", status: "completed", download_url: "https://zoom.us/rec/download/t1", recording_type: "audio_transcript" };
const audioFile = { id: "a1", file_type: "M4A", file_extension: "M4A", status: "completed", file_size: 4_000_000, download_url: "https://zoom.us/rec/download/a1", recording_type: "audio_only" };
const videoFile = { id: "v1", file_type: "MP4", file_extension: "MP4", status: "completed", file_size: 90_000_000, download_url: "https://zoom.us/rec/download/v1", recording_type: "shared_screen_with_speaker_view" };

class FakeZoom implements ZoomApi {
  calls: { path: string; query?: ZoomRequest["query"] }[] = [];
  downloads: string[] = [];
  constructor(private readonly replies: Record<string, unknown>, private readonly files: Record<string, Buffer> = {}) {}

  async request<T>(path: string, init: ZoomRequest = {}): Promise<T> {
    this.calls.push({ path, query: init.query });
    const reply = this.replies[path];
    if (reply instanceof Error) throw reply;
    if (reply === undefined) throw new ZoomApiError(404, 3001);
    return (typeof reply === "function" ? reply(init.query) : reply) as T;
  }

  async download(url: string): Promise<Buffer> {
    this.downloads.push(url);
    const file = this.files[url];
    if (!file) throw new ZoomApiError(404, null);
    return file;
  }
}

class MemoryStore implements MeetingStore {
  rows = new Map<string, TablesInsert<"meetings"> & { id: string }>();
  participants: TablesInsert<"meeting_participants">[] = [];
  uploads: { path: string; bytes: number; contentType: string }[] = [];

  async find(uuids: string[]) {
    const out = new Map<string, StoredMeeting>();
    for (const r of this.rows.values()) if (uuids.includes(r.provider_meeting_id)) out.set(r.provider_meeting_id, { id: r.id, status: r.status!, provider_meta: r.provider_meta! });
    return out;
  }
  async save(row: TablesInsert<"meetings">) {
    const existing = [...this.rows.values()].find((r) => r.provider_meeting_id === row.provider_meeting_id);
    const id = existing?.id ?? `m${this.rows.size + 1}`;
    this.rows.set(id, { ...existing, ...row, id });
    return id;
  }
  async update(id: string, patch: TablesUpdate<"meetings">) {
    this.rows.set(id, { ...this.rows.get(id)!, ...patch } as TablesInsert<"meetings"> & { id: string });
  }
  async hasParticipants(meetingId: string) {
    return this.participants.some((p) => p.meeting_id === meetingId);
  }
  async addParticipants(rows: TablesInsert<"meeting_participants">[]) {
    this.participants.push(...rows);
  }
  async upload(path: string, bytes: Buffer, contentType: string) {
    this.uploads.push({ path, bytes: bytes.length, contentType });
  }
}

/** Marks sealed values, so the test can see what was sealed under which field. */
const sealer = {
  seal: async (field: string, value: string | null) => (value == null ? null : `sealed:${field}:${value}`),
  sealAddress: async (value: string | null) => (value == null ? null : `addr:${value}`),
};

const ctx = { userId: "user-1", accountId: "acct-1", selfId: "zoom-me", selfEmail: "thandi@konva.co.za", canReadMeeting: true, canReadParticipants: true, now: () => NOW };

const participants = {
  participants: [
    { id: "zoom-me", name: "Thandi Nkosi", user_email: "Thandi@konva.co.za" },
    { id: "", name: "Pieter van Wyk", user_email: "pieter@example.co.za" },
    { id: "", name: "Pieter van Wyk", user_email: "pieter@example.co.za" }, // rejoined
    { id: "", name: "Dial-in Caller", user_email: "" },
  ],
  next_page_token: "",
};

const recordingsReply = (meetings: ZoomRecordingMeeting[]) => (query: Record<string, unknown>) =>
  query.next_page_token ? { meetings: [] } : { from: query.from, to: query.to, meetings, next_page_token: "" };

test("stores Zoom's own transcript as segments, with the join link and participants", async () => {
  const uuid = "aDYlohsHRtCd4ii1uC2+hA==";
  const zoom = new FakeZoom(
    {
      "/users/me/recordings": recordingsReply([meeting(uuid, [videoFile, audioFile, transcriptFile])]),
      "/meetings/81234567890": { join_url: "https://us02web.zoom.us/j/81234567890?pwd=abc" },
      [`/past_meetings/${encodeURIComponent(uuid)}/participants`]: participants,
    },
    { [transcriptFile.download_url]: Buffer.from(VTT) },
  );
  const store = new MemoryStore();
  const stored = await new RecordingSync(zoom, store, sealer, ctx).sync(new Date(NOW - 7 * 86_400_000));
  assert.equal(stored, 1);

  const [row] = [...store.rows.values()];
  assert.equal(row.platform, "zoom");
  assert.equal(row.status, "transcribed");
  assert.equal(row.transcript_source, "provider");
  assert.equal(row.provider_meeting_id, uuid);
  assert.equal(row.title, "sealed:meeting_title:Offer review");
  assert.deepEqual(row.provider_meta, { uuid, meeting_id: 81234567890, join_url: "https://us02web.zoom.us/j/81234567890?pwd=abc" });
  assert.ok(row.transcript!.startsWith("sealed:transcript:"));
  assert.deepEqual(JSON.parse(row.transcript!.slice("sealed:transcript:".length)), [
    { speaker: "Thandi Nkosi", start_ms: 1000, text: "Thanks for joining." },
    { speaker: "Pieter van Wyk", start_ms: 4000, text: "Happy to." },
  ]);
  assert.deepEqual(zoom.downloads, [transcriptFile.download_url]); // never the video or audio

  assert.deepEqual(
    store.participants.map((p) => ({ name: p.name, address: p.address, is_self: p.is_self })),
    [
      { name: "sealed:name:Thandi Nkosi", address: "addr:thandi@konva.co.za", is_self: true },
      { name: "sealed:name:Pieter van Wyk", address: "addr:pieter@example.co.za", is_self: false },
      { name: "sealed:name:Dial-in Caller", address: null, is_self: false },
    ],
  );
});

test("uploads the audio for the AI worker when there is no transcript", async () => {
  const zoom = new FakeZoom(
    { "/users/me/recordings": recordingsReply([meeting("u-audio", [videoFile, audioFile])]) },
    { [audioFile.download_url]: Buffer.alloc(1234) },
  );
  const store = new MemoryStore();
  await new RecordingSync(zoom, store, sealer, ctx).sync(new Date(NOW - 86_400_000 * 3));

  const [row] = [...store.rows.values()];
  assert.equal(row.status, "waiting");
  assert.equal(row.transcript_source, "recording");
  assert.equal(row.transcript, undefined);
  const recording = (row.provider_meta as { recording: { storage_path: string; mime_type: string } }).recording;
  assert.match(recording.storage_path, new RegExp(`^user-1/meetings/${row.id}/[0-9a-f-]{36}$`));
  assert.equal(recording.mime_type, "audio/mp4");
  assert.deepEqual(store.uploads, [{ path: recording.storage_path, bytes: 1234, contentType: "audio/mp4" }]);
  assert.equal((row.provider_meta as { join_url: unknown }).join_url, null); // the meeting has gone from Zoom (404)

  // The next poll leaves it with the AI worker.
  await new RecordingSync(zoom, store, sealer, ctx).sync(new Date(NOW - 86_400_000 * 3));
  assert.equal(store.uploads.length, 1);
  assert.equal(zoom.downloads.length, 1);
});

test("marks a meeting with neither a transcript nor audio as having none", async () => {
  const zoom = new FakeZoom({ "/users/me/recordings": recordingsReply([meeting("u-video", [videoFile])]) });
  const store = new MemoryStore();
  await new RecordingSync(zoom, store, sealer, { ...ctx, canReadParticipants: false }).sync(new Date(NOW - 86_400_000));
  const [row] = [...store.rows.values()];
  assert.equal(row.status, "no_transcript");
  assert.equal(store.participants.length, 0);
});

test("waits while the transcript is being made, then stores it", async () => {
  const processing = { ...transcriptFile, status: "processing", download_url: undefined };
  let files: ZoomRecordingFile[] = [audioFile, processing];
  const zoom = new FakeZoom(
    { "/users/me/recordings": (q: Record<string, unknown>) => recordingsReply([meeting("u-later", files)])(q), "/past_meetings/u-later/participants": participants },
    { [transcriptFile.download_url]: Buffer.from(VTT) },
  );
  const store = new MemoryStore();
  const sync = new RecordingSync(zoom, store, sealer, ctx);
  await sync.sync(new Date(NOW - 86_400_000 * 2));
  assert.equal([...store.rows.values()][0].status, "waiting");
  assert.equal(store.uploads.length, 0);
  assert.equal(store.participants.length, 3);

  files = [audioFile, transcriptFile];
  await sync.sync(new Date(NOW - 86_400_000 * 2));
  const [row] = [...store.rows.values()];
  assert.equal(store.rows.size, 1);
  assert.equal(row.status, "transcribed");
  assert.equal(store.participants.length, 3); // not added twice
});

test("plans each meeting from its files", () => {
  const ended = (hoursAgo: number, files: ZoomRecordingMeeting["recording_files"]) => meeting("x", files, hoursAgo + 0.5);
  assert.equal(planMeeting(ended(24, [transcriptFile]), NOW).kind, "transcript");
  assert.equal(planMeeting(ended(24, [{ ...transcriptFile, status: "processing" }]), NOW).kind, "wait");
  // Just ended: Zoom may still be making the transcript, so the audio is not used yet.
  assert.equal(planMeeting(ended(TRANSCRIPT_GRACE_MS / HOUR / 2, [audioFile]), NOW).kind, "wait");
  assert.equal(planMeeting(ended(24, [audioFile]), NOW).kind, "audio");
  assert.equal(planMeeting(ended(24, [{ ...audioFile, file_size: MAX_RECORDING_BYTES + 1 }]), NOW).kind, "too_large");
  assert.equal(planMeeting(ended(24, [videoFile]), NOW).kind, "none");
  assert.equal(planMeeting(ended(24, []), NOW).kind, "none");
});

test("asks for at most a month at a time, following page tokens", async () => {
  const pages: Record<string, unknown> = {
    "/users/me/recordings": (q: Record<string, unknown>) =>
      q.next_page_token === "p2" ? { meetings: [meeting("u2", [videoFile])], next_page_token: "" } : { meetings: [meeting("u1", [videoFile])], next_page_token: "p2" },
  };
  const zoom = new FakeZoom(pages);
  const store = new MemoryStore();
  await new RecordingSync(zoom, store, sealer, { ...ctx, canReadParticipants: false, canReadMeeting: false }).sync(new Date(NOW - 45 * 86_400_000));
  const windows = zoom.calls.filter((c) => c.path === "/users/me/recordings" && !c.query?.next_page_token);
  assert.equal(windows.length, 2);
  for (const w of windows) {
    const days = (Date.parse(String(w.query!.to)) - Date.parse(String(w.query!.from))) / 86_400_000;
    assert.ok(days <= 30, `window of ${days} days`);
  }
  assert.equal(store.rows.size, 2);
});

test("a rate limit stops the sync so the connector can back off", async () => {
  const zoom = new FakeZoom({ "/users/me/recordings": new ZoomApiError(429, null, 60_000) });
  await assert.rejects(new RecordingSync(zoom, new MemoryStore(), sealer, ctx).sync(new Date(NOW - 86_400_000)), (err: unknown) => err instanceof ZoomApiError && err.retryAfterMs === 60_000);
});

test("double-escapes a meeting UUID that starts with a slash", async () => {
  const uuid = "/ajXp112QmuoKj4854875==";
  const zoom = new FakeZoom({
    "/users/me/recordings": recordingsReply([meeting(uuid, [videoFile])]),
    [`/past_meetings/${encodeURIComponent(encodeURIComponent(uuid))}/participants`]: participants,
  });
  const store = new MemoryStore();
  await new RecordingSync(zoom, store, sealer, ctx).sync(new Date(NOW - 86_400_000));
  assert.equal(store.participants.length, 3);
});
