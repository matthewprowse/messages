// The rules for which files are copied into Konva's storage (docs/PLAN.md, Fair Usage and Storage):
//   * a video over 25 MB is not copied; the original stays at the provider (not_kept = 'video_link')
//   * an email attachment over 5 MB, or on a message older than 30 days, is not copied up front (not_kept = 'deferred');
//     it is fetched from the provider the first time its owner opens it (ingest/fetch-requests.ts). Chat media
//     (WhatsApp and the like) is always copied up front, since the chat server drops it after a while
//   * each seat keeps 20 GB. At 100% new files stop being saved (not_kept = 'over_cap') and the original stays
//     where it is; a message that already has a saved file may finish up to 110%, so a thread never fails midway
//   * a team pools its seats' storage (seats x 20 GB, from public.team_storage_for)
// Nothing is ever deleted because of the cap. The numbers are sizes only.

import { db } from "./db";

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** Videos over this are kept as a link to the original. VIDEO_COPY_MAX_MB overrides it. */
export const VIDEO_COPY_MAX_BYTES = (Number(process.env.VIDEO_COPY_MAX_MB) || 25) * MB;
/** An email attachment up to this size is copied when the mail arrives. EAGER_COPY_MAX_MB overrides it. */
export const EAGER_COPY_MAX_BYTES = (Number(process.env.EAGER_COPY_MAX_MB) || 5) * MB;
/** An email attachment on a message younger than this many days is copied when the mail arrives. EAGER_COPY_MAX_DAYS overrides it. */
export const EAGER_COPY_MAX_DAYS = Number(process.env.EAGER_COPY_MAX_DAYS) || 30;
/** The storage each seat includes. STORAGE_CAP_GB overrides it. */
export const SEAT_CAP_BYTES = (Number(process.env.STORAGE_CAP_GB) || 20) * GB;
/** How far past the cap a message that has already started saving may go. */
export const GRACE = 0.1;
/** How long a person's usage is reused before it is read again. */
const USAGE_TTL_MS = 60_000;

/** Why a file was not copied: stored in attachments.not_kept and shown as "Not Kept Here". */
export type NotKept = "video_link" | "over_cap" | "deferred" | "unavailable";

/**
 * Whether an email attachment is left at the provider until its owner opens it: it is over the eager size, or its
 * message is older than the eager age. A message with no known date counts as new, so the file is copied as before.
 * Chat media and stickers never come through here.
 */
export function isDeferred(sizeBytes: number | null | undefined, sentAt: Date | string | null | undefined, now = Date.now()): boolean {
  if ((sizeBytes ?? 0) > EAGER_COPY_MAX_BYTES) return true;
  const sent = sentAt ? new Date(sentAt).getTime() : NaN;
  return Number.isFinite(sent) && now - sent >= EAGER_COPY_MAX_DAYS * 24 * 60 * 60 * 1000;
}

/** Whether a video is too big to copy. Other kinds are never kept as links. */
export function isVideoLink(kind: string | null | undefined, sizeBytes: number | null | undefined): boolean {
  return kind === "video" && (sizeBytes ?? 0) > VIDEO_COPY_MAX_BYTES;
}

export type CapState = "open" | "grace" | "full";

/** Where a person stands against their cap: open under 100%, grace from 100% to 110%, full from 110%. */
export function capState(usedBytes: number, capBytes: number): CapState {
  if (usedBytes < capBytes) return "open";
  return usedBytes < capBytes * (1 + GRACE) ? "grace" : "full";
}

/**
 * Whether one more file may be saved. Under the cap always; in the grace band only when the message the file
 * belongs to already has a saved file (so a thread finishes); never when full.
 */
export function maySave(state: CapState, messageStarted: boolean): boolean {
  return state === "open" || (state === "grace" && messageStarted);
}

/** Whether new files are being refused for this person: only worth fetching a file while this is false. */
export function refusing(state: CapState): boolean {
  return state !== "open";
}

export interface Usage {
  used: number;
  cap: number;
}

const cache = new Map<string, { at: number; usage: Promise<Usage> }>();

async function readUsage(userId: string): Promise<Usage> {
  const team = await db.rpc("team_storage_for", { p_user: userId });
  const t = team.data as { seats?: number; bytes?: number } | null;
  if (!team.error && t && typeof t.seats === "number") return { used: Number(t.bytes ?? 0), cap: t.seats * SEAT_CAP_BYTES };
  const rows = await db.from("storage_usage").select("bytes").eq("user_id", userId);
  if (rows.error) throw new Error("storage usage failed");
  return { used: (rows.data ?? []).reduce((n, r) => n + Number(r.bytes ?? 0), 0), cap: SEAT_CAP_BYTES };
}

/** A person's stored bytes and cap, read at most once a minute. A team shares seats x 20 GB across its members. */
export function usageFor(userId: string, now = Date.now()): Promise<Usage> {
  const hit = cache.get(userId);
  if (hit && now - hit.at < USAGE_TTL_MS) return hit.usage;
  const usage = readUsage(userId);
  usage.catch(() => cache.delete(userId));
  cache.set(userId, { at: now, usage });
  return usage;
}

/** Adds a saved file to the cached usage, so a burst of files in one minute is counted as it lands. */
export async function noteSaved(userId: string, bytes: number): Promise<void> {
  const hit = cache.get(userId);
  if (!hit) return;
  const usage = await hit.usage.catch(() => null);
  if (usage) hit.usage = Promise.resolve({ used: usage.used + bytes, cap: usage.cap });
}

/** The state to act on now. A usage that cannot be read fails open: files are kept, as they were before the cap. */
export async function stateFor(userId: string): Promise<CapState> {
  try {
    const { used, cap } = await usageFor(userId);
    return capState(used, cap);
  } catch {
    return "open";
  }
}

/** Forgets the cache. For tests. */
export function resetUsageCache() {
  cache.clear();
}
