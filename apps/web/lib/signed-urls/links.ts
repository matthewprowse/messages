// Photos and attachments live in private buckets, so each needs a short-lived signed link. Links asked
// for in the same tick (a grid of thumbnails, a list of avatars) go out as one request per bucket, and
// a link is handed out again while it has enough time left. Cached in memory and in sessionStorage.

import { supabase } from "../supabase";
import { fresh, keyOf, type Entry } from "./cache-rules";
import { thumbCache } from "./thumb-store";

const LINK_SECONDS = 60 * 60;
/** A link made for a download is only needed for the click that follows, so it lives five minutes. */
const DOWNLOAD_SECONDS = 5 * 60;
/** Small pictures for grid tiles, cut by Supabase Storage so a tile does not download the original. */
const THUMB_TRANSFORM = { width: 256, resize: "cover" as const };
const THUMB_PARALLEL = 6;
const STORE_KEY = "konva:signed-urls";
const STORE_MAX = 1500;
const MAX_PER_REQUEST = 100;
const RETRY_FAILED_MS = 60 * 1000;
/** Default time a cached link must still have left, enough for a thumbnail or avatar to load. */
export const MIN_LEFT_MS = 10 * 60 * 1000;
/** Past this many cached links, dead ones are dropped so a long session does not keep them all. */
const SWEEP_AT = 2000;
const SWEEP_EVERY_MS = 60_000;
let lastSweep = 0;

const cache = new Map<string, Entry>();
const waiting = new Map<string, Map<string, ((url: string | null) => void)[]>>(); // bucket, then path
let scheduled = false;

// Links are also kept in sessionStorage with their expiry, so a reload or a second tab does not ask for
// every visible link again. It can be missing or full, so every use is guarded and optional.
let hydrated = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(STORE_KEY) ?? "{}") as Record<string, [string, number]>;
    const now = Date.now();
    for (const [key, [url, expires]] of Object.entries(stored)) {
      if (typeof url !== "string" || typeof expires !== "number" || expires - now <= MIN_LEFT_MS) continue;
      cache.set(key, { url: Promise.resolve(url), expires, value: url });
    }
    transformsBroken = window.sessionStorage.getItem(`${STORE_KEY}:no-transforms`) === "1";
  } catch {
    // Storage unavailable: carry on without it.
  }
}

function saveSoon() {
  if (typeof window === "undefined" || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    try {
      const now = Date.now();
      const live = [...cache].filter(([, e]) => e.value && e.expires - now > MIN_LEFT_MS).slice(-STORE_MAX);
      window.sessionStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(live.map(([k, e]) => [k, [e.value, e.expires]]))));
    } catch {
      // Full or blocked: the in-memory cache still works.
    }
  }, 1000);
}

// Thumbnails are cut by Storage image transforms. If the project does not support them, the first few
// thumbnails fail while their originals load, and tiles go back to originals for the rest of the session.
let transformsBroken = false;
let thumbFallbacks = 0;
let thumbLoads = 0;

export function thumbsEnabled() {
  hydrate();
  return !transformsBroken;
}

/** A tile reports how its picture went, so a project without transforms stops asking for them. */
export function reportThumb(outcome: "loaded" | "fell-back") {
  if (outcome === "loaded") thumbLoads++;
  else if (++thumbFallbacks >= 3 && thumbLoads === 0) {
    transformsBroken = true;
    try { window.sessionStorage.setItem(`${STORE_KEY}:no-transforms`, "1"); } catch { /* ignore */ }
  }
}

async function ask(bucket: string, paths: string[]): Promise<Map<string, string>> {
  try {
    const { data } = await supabase.storage.from(bucket).createSignedUrls(paths, LINK_SECONDS);
    return new Map((data ?? []).flatMap((d) => (d.path && d.signedUrl && !d.error ? [[d.path, d.signedUrl] as const] : [])));
  } catch {
    return new Map();
  }
}

let thumbRunning = 0;
const thumbQueue: (() => void)[] = [];

async function signThumb(bucket: string, path: string): Promise<string | null> {
  if (thumbRunning >= THUMB_PARALLEL) await new Promise<void>((resolve) => thumbQueue.push(resolve));
  thumbRunning++;
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, LINK_SECONDS, { transform: THUMB_TRANSFORM });
    return error ? null : data?.signedUrl ?? null;
  } catch {
    return null;
  } finally {
    thumbRunning--;
    thumbQueue.shift()?.();
  }
}

function flush() {
  scheduled = false;
  const batches = [...waiting];
  waiting.clear();
  for (const [bucket, byPath] of batches) {
    const paths = [...byPath.keys()];
    for (let i = 0; i < paths.length; i += MAX_PER_REQUEST) {
      const chunk = paths.slice(i, i + MAX_PER_REQUEST);
      void ask(bucket, chunk).then((found) => {
        for (const path of chunk) {
          const url = found.get(path) ?? null;
          for (const resolve of byPath.get(path) ?? []) resolve(url);
        }
      });
    }
  }
}

/**
 * A signed link to a stored file, or null when there is none. A cached link is reused only while it
 * has more than minLeftMs left, so a viewer kept open can ask for more headroom than a thumbnail.
 */
export function signedUrl(bucket: string, path: string, minLeftMs = MIN_LEFT_MS, thumb = false): Promise<string | null> {
  hydrate();
  const key = keyOf(bucket, path, thumb);
  sweepIfDue();
  const hit = cache.get(key);
  if (fresh(hit, minLeftMs)) return hit.url;
  const entry: Entry = {
    expires: Date.now() + LINK_SECONDS * 1000,
    url: thumb
      ? signThumb(bucket, path)
      : new Promise((resolve) => {
          const byPath = waiting.get(bucket) ?? new Map<string, ((url: string | null) => void)[]>();
          waiting.set(bucket, byPath);
          byPath.set(path, [...(byPath.get(path) ?? []), resolve]);
          if (!scheduled) {
            scheduled = true;
            setTimeout(flush, 0);
          }
        }),
  };
  // A failure is remembered briefly, so a broken path is not asked for again by every render.
  void entry.url.then((url) => {
    entry.value = url;
    if (!url) entry.expires = Date.now() + RETRY_FAILED_MS;
    else saveSoon();
  });
  sweepIfDue();
  cache.set(key, entry);
  return entry.url;
}

/** A fresh link that saves the file under its own name. Valid for five minutes, so it is made on click. */
export async function downloadUrl(bucket: string, path: string, name: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, DOWNLOAD_SECONDS, { download: name });
    return error ? null : data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

function sweep() {
  const now = Date.now();
  lastSweep = now;
  for (const [key, entry] of cache) if (entry.value !== undefined && entry.expires <= now) cache.delete(key);
}

/** Dead links are dropped at most once a minute as links are asked for, not only past SWEEP_AT, so a quiet session does not hold them. */
function sweepIfDue() {
  if (cache.size >= SWEEP_AT || Date.now() - lastSweep > SWEEP_EVERY_MS) sweep();
}

/**
 * Forgets every signed link and opened picture, in memory and in sessionStorage. Signing out calls it: the links are
 * bearer URLs for the last person's files, and a tab left open must not hand them to the next one.
 */
export function clearSignedUrls() {
  cache.clear();
  waiting.clear();
  clearTimeout(saveTimer);
  saveTimer = undefined;
  hydrated = true; // nothing stored is read back after this
  thumbCache.clear();
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORE_KEY);
  } catch {
    // Storage unavailable: there was nothing kept there.
  }
}

/** A link already in hand, so a remounted image shows at once instead of flashing a placeholder. */
export function cachedUrl(bucket: string, path: string, thumb: boolean): string | null | undefined {
  hydrate();
  const hit = cache.get(keyOf(bucket, path, thumb));
  return fresh(hit, MIN_LEFT_MS) ? hit.value : undefined;
}
