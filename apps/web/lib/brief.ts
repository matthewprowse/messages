// The spoken daily brief (public.briefs), written by the AI worker each morning or when asked for. The
// script and the audio are encrypted. The audio comes in parts (public.brief_parts), each a WAV file in
// base64, so playing can start as soon as the first short part is ready. A part is a sealed file in the
// private "brief-audio" bucket (audio_path), or, for parts stored before that, the sealed base64 itself
// in the audio column.
import { FIELD } from "@messages/crypto/fields";
import { supabase } from "./supabase";
import { open } from "./vault";
import { limitReached, REQUESTS_PER_DAY, requestsLeft, nextRequestAt } from "./brief-pace";

const AUDIO_BUCKET = "brief-audio";

export interface DailyBrief {
  id: string;
  /** written: the script is stored and not yet spoken. speak_pending: asked to be spoken. speaking: the script and first parts are stored, more are coming. */
  status: "pending" | "working" | "written" | "speak_pending" | "speaking" | "ready" | "failed";
  /** How many audio parts it has, once known. */
  parts?: number;
  voice?: string;
  updatedAt: string;
}

/** The voices the worker can speak with (profiles.brief_voice allows these), each with a sample in /voices. */
export const VOICES: { id: string; label: string }[] = [
  { id: "Kore", label: "Kore, Firm" },
  { id: "Aoede", label: "Aoede, Breezy" },
  { id: "Sulafat", label: "Sulafat, Warm" },
  { id: "Charon", label: "Charon, Informative" },
  { id: "Achird", label: "Achird, Friendly" },
  { id: "Iapetus", label: "Iapetus, Clear" },
];

/** Playback speeds. 1.15 is the default: the voice's own pace is slow for a brief. */
export const SPEEDS = [1, 1.15, 1.3, 1.5];

export const sampleUrl = (voice: string) => `/voices/${voice.toLowerCase()}.m4a`;

/** "2026-10-23", the local date the brief is for. */
export function localDate(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Today's brief, or null when there is none yet. Filtered by user as well as date, so it never rests on row security alone. */
export async function loadBrief(day: string, userId: string): Promise<DailyBrief | null> {
  const { data, error } = await supabase.from("briefs").select("id, status, parts, voice, updated_at").eq("for_date", day).eq("user_id", userId).maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    status: data.status as DailyBrief["status"],
    parts: data.parts ?? undefined,
    voice: data.voice ?? undefined,
    updatedAt: data.updated_at,
  };
}

/** How a request for a brief went. A refused one carries when the next is allowed (ISO), when the database said. */
export type BriefRequest = { ok: true } | { ok: false; limit: boolean; nextAt: string | null };

/**
 * Asks the AI worker for today's brief, or for a fresh one. The database allows three such requests in
 * any 24 hours (SQLSTATE 54000, 'brief_request_limit'); the fourth comes back as a limit with the time
 * the next is allowed.
 */
export async function requestBrief(day: string, userId: string): Promise<BriefRequest> {
  const failed = (error: { code?: string; message?: string; details?: string | null }): BriefRequest => {
    const hit = limitReached(error);
    return { ok: false, limit: !!hit, nextAt: hit?.nextAt ?? null };
  };
  const { error } = await supabase.from("briefs").insert({ user_id: userId, for_date: day, status: "pending" });
  if (!error) return { ok: true };
  // Today's brief exists already: ask for it to be written again.
  if (error.code !== "23505") return failed(error);
  const again = await supabase.from("briefs").update({ status: "pending", updated_at: new Date().toISOString() }).eq("for_date", day).eq("user_id", userId);
  return again.error ? failed(again.error) : { ok: true };
}

/** Requests for a brief made in the last 24 hours (public.brief_requests, read-only here), newest first. Null when they could not be read. */
async function loadRequests(userId: string): Promise<string[] | null> {
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { data, error } = await supabase.from("brief_requests").select("requested_at").eq("user_id", userId).gte("requested_at", since).order("requested_at", { ascending: false });
  return error || !data ? null : data.map((r) => r.requested_at);
}

/** What is left of the daily allowance of asking for a brief, and when the next request is allowed once none is. Null when unknown. */
export async function loadAllowance(userId: string): Promise<{ left: number; of: number; nextAt: number | null } | null> {
  const log = await loadRequests(userId);
  if (!log) return null;
  const now = Date.now();
  return { left: requestsLeft(log, now), of: REQUESTS_PER_DAY, nextAt: nextRequestAt(log, now) };
}

/**
 * Asks the AI worker to speak a brief that was written without speech (the morning one is, as speech is
 * most of what a brief costs). Resolves to false when that failed. A brief that is not 'written' any
 * more (already asked for, or being spoken) is left as it is.
 */
export async function requestSpeech(briefId: string, userId: string): Promise<boolean> {
  const { error } = await supabase
    .from("briefs")
    .update({ status: "speak_pending", updated_at: new Date().toISOString() })
    .eq("id", briefId)
    .eq("user_id", userId)
    .eq("status", "written");
  return !error;
}

/** Sealed base64 audio as a playable WAV blob, or null when it cannot be opened. */
async function unseal(sealed: string): Promise<Blob | null> {
  const b64 = await open(FIELD.brief, sealed);
  if (!b64) return null;
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: "audio/wav" });
}

/** One part of a brief's audio as a playable WAV blob, or null when it is not stored yet. */
export async function loadBriefPart(briefId: string, seq: number, userId: string): Promise<Blob | null> {
  const { data, error } = await supabase.from("brief_parts").select("audio, audio_path").eq("brief_id", briefId).eq("user_id", userId).eq("seq", seq).maybeSingle();
  if (error || !data) return null;
  try {
    if (data.audio_path) {
      // The file is read under row security: the bucket lets a user read only their own folder.
      const file = await supabase.storage.from(AUDIO_BUCKET).download(data.audio_path);
      return file.error || !file.data ? null : await unseal(await file.data.text());
    }
    return data.audio ? await unseal(data.audio) : null;
  } catch {
    return null;
  }
}

export interface BriefSettings {
  /** "07:00" */
  time: string;
  voice: string;
  speed: number;
}

export async function loadBriefSettings(userId: string): Promise<BriefSettings> {
  const { data } = await supabase.from("profiles").select("briefing_time, brief_voice, brief_speed").eq("user_id", userId).maybeSingle();
  return { time: (data?.briefing_time ?? "07:00").slice(0, 5), voice: data?.brief_voice ?? "Kore", speed: Number(data?.brief_speed ?? 1.15) };
}

export async function saveBriefSettings(userId: string, patch: Partial<BriefSettings>): Promise<boolean> {
  const row: { briefing_time?: string; brief_voice?: string; brief_speed?: number } = {};
  if (patch.time !== undefined) row.briefing_time = patch.time;
  if (patch.voice !== undefined) row.brief_voice = patch.voice;
  if (patch.speed !== undefined) row.brief_speed = patch.speed;
  const { error } = await supabase.from("profiles").update(row).eq("user_id", userId);
  return !error;
}

/** Keeps profiles.timezone in step with this device, so the brief is written at the right local time. */
export async function syncTimezone(userId: string): Promise<void> {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!zone) return;
  const { data } = await supabase.from("profiles").select("timezone").eq("user_id", userId).maybeSingle();
  if (data && data.timezone !== zone) await supabase.from("profiles").update({ timezone: zone }).eq("user_id", userId);
}
