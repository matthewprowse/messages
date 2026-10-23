// The spoken daily brief (public.briefs), written by the AI worker each morning or when asked for. The
// script and the audio are encrypted; the audio is a WAV file in base64 and is only fetched to play it.
import { FIELD } from "@messages/crypto/fields";
import { supabase } from "./supabase";
import { open } from "./vault";

export interface DailyBrief {
  id: string;
  status: "pending" | "working" | "ready" | "failed";
  script?: string;
  seconds?: number;
  updatedAt: string;
}

/** "2026-10-23", the local date the brief is for. */
export function localDate(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Today's brief, or null when there is none yet (or the briefs table is not there yet). */
export async function loadBrief(day: string): Promise<DailyBrief | null> {
  const { data, error } = await supabase.from("briefs").select("id, status, script, seconds, updated_at").eq("for_date", day).maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    status: data.status as DailyBrief["status"],
    script: (await open(FIELD.brief, data.script)) ?? undefined,
    seconds: data.seconds ?? undefined,
    updatedAt: data.updated_at,
  };
}

/** Asks the AI worker for today's brief, or for a fresh one. Resolves to false when that failed. */
export async function requestBrief(day: string): Promise<boolean> {
  const { error } = await supabase.from("briefs").insert({ for_date: day, status: "pending" });
  if (!error) return true;
  // Today's brief exists already: ask for it to be written again.
  if (error.code !== "23505") return false;
  const again = await supabase.from("briefs").update({ status: "pending", updated_at: new Date().toISOString() }).eq("for_date", day);
  return !again.error;
}

/** The brief's audio as a playable WAV blob. */
export async function loadBriefAudio(id: string): Promise<Blob | null> {
  const { data, error } = await supabase.from("briefs").select("audio").eq("id", id).maybeSingle();
  if (error || !data?.audio) return null;
  const b64 = await open(FIELD.brief, data.audio);
  if (!b64) return null;
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: "audio/wav" });
}

/** Keeps profiles.timezone in step with this device, so the brief is written at the right local time. */
export async function syncTimezone(userId: string): Promise<void> {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!zone) return;
  const { data } = await supabase.from("profiles").select("timezone").eq("user_id", userId).maybeSingle();
  if (data && data.timezone !== zone) await supabase.from("profiles").update({ timezone: zone }).eq("user_id", userId);
}
