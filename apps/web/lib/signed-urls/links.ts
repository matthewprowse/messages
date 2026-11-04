// Photos and attachments live in private buckets, so each needs a signed link. Links asked for in the same tick (a
// grid of thumbnails, a list of avatars) go out as one request per bucket, and a link is handed out again while it has
// enough time left. Cached in memory and in localStorage, so an installed app keeps the same address for a picture
// across a day of launches and the browser's HTTP cache serves it instead of downloading it again.
//
// A signed link is a bearer address to one of the signed-in user's own files (a sealed file is ciphertext), valid for
// LINK_SECONDS. In localStorage they outlive a closed app for that long, as the open app's always could: they are stored
// with the user's id, read back only for that user, and wiped on sign-out and when a different user signs in.

import { supabase } from "../supabase";
import { fresh, keyOf, type Entry } from "./cache-rules";
import { readStoredLinks, storedLinksForm } from "./stored-links";
import { thumbCache } from "./thumb-store";

/** A day: a link, and so the browser's cached copy of its picture, is reused across a day of launches. */
const LINK_SECONDS = 24 * 60 * 60;
/** A link made for a download is only needed for the click that follows, so it lives five minutes. */
const DOWNLOAD_SECONDS = 5 * 60;
/** Small pictures for grid tiles, cut by Supabase Storage so a tile does not download the original. */
const THUMB_TRANSFORM = { width: 256, resize: "cover" as const };
const THUMB_PARALLEL = 6;
const STORE_KEY = "konva:signed-urls";
const STORE_MAX = 1500;
/** Writing the stored cache stringifies up to STORE_MAX links, so it happens at most this often, in idle time. */
const SAVE_EVERY_MS = 5_000;
/** How long a due write may wait for the browser to be idle before it runs anyway. */
const SAVE_IDLE_WAIT_MS = 2_000;
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

// Links are also kept in localStorage with their expiry and their user, so a reload, a second tab or the next launch
// does not ask for every visible link again. It can be missing or full, so every use is guarded and optional.
let hydrated = false;
let flagsRead = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saveIdle: number | undefined;
/** Links came back since the last write. */
let dirty = false;
/** The signed-in user the cache belongs to: null until the session is known, and while signed out. */
let owner: string | null = null;

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  if (!flagsRead) {
    flagsRead = true;
    try {
      transformsBroken = window.sessionStorage.getItem(`${STORE_KEY}:no-transforms`) === "1";
    } catch {
      // Storage unavailable: carry on without it.
    }
  }
  // Stored links are read back only once it is known whose they may be. Supabase reads the session before the app
  // shows anything signed, so in practice this is the first call.
  if (!owner) return;
  hydrated = true;
  try {
    for (const [key, url, expires] of readStoredLinks(window.localStorage.getItem(STORE_KEY), owner, Date.now(), MIN_LEFT_MS)) {
      if (!cache.has(key)) cache.set(key, { url: Promise.resolve(url), expires, value: url });
    }
  } catch {
    // Storage unavailable: carry on without it.
  }
}

function save() {
  if (!dirty || !owner || typeof window === "undefined") return;
  dirty = false;
  try {
    window.localStorage.setItem(STORE_KEY, storedLinksForm(cache, owner, Date.now(), MIN_LEFT_MS, STORE_MAX));
  } catch {
    // Full or blocked: the in-memory cache still works.
  }
}

function cancelSave() {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  if (saveIdle !== undefined) window.cancelIdleCallback?.(saveIdle);
  saveIdle = undefined;
}

// Links come back in bursts as a list scrolls: one write per SAVE_EVERY_MS at most, when the browser is idle. Safari has
// no requestIdleCallback, so there it writes when the wait ends.
function saveSoon() {
  dirty = true;
  if (typeof window === "undefined" || saveTimer || saveIdle !== undefined) return;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    if (typeof window.requestIdleCallback !== "function") return save();
    saveIdle = window.requestIdleCallback(() => { saveIdle = undefined; save(); }, { timeout: SAVE_IDLE_WAIT_MS });
  }, SAVE_EVERY_MS);
}

if (typeof window !== "undefined") {
  // An installed app is usually closed from the app switcher after it is hidden: write what is waiting while it can.
  const saveNow = () => { cancelSave(); save(); };
  window.addEventListener("pagehide", saveNow);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveNow(); });
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

// One request per thumbnail: Storage signs a resized copy only one path at a time (the batch endpoint takes no
// transform, and the transform is part of what the token signs). They are cached and stored like any other link.
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
    else if (cache.get(key) === entry) saveSoon();
  });
  sweepIfDue();
  // Moved to the end, so the stored cache (capped to the newest) keeps the links in use.
  cache.delete(key);
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
 * Forgets every signed link and opened picture, in memory and in localStorage. Signing out calls it, and so does a
 * different user signing in: the links are bearer URLs for the last person's files, and a device or tab left signed in
 * must not hand them to the next one.
 */
export function clearSignedUrls() {
  cache.clear();
  waiting.clear();
  dirty = false;
  hydrated = true; // nothing stored is read back after this
  thumbCache.clear();
  if (typeof window === "undefined") return;
  cancelSave();
  try {
    window.localStorage.removeItem(STORE_KEY);
  } catch {
    // Storage unavailable: there was nothing kept there.
  }
}

// Whose links the cache holds. Signing out is also cleared by the callers of clearSignedUrls; a session for a
// different user (signed in from another tab while this one was open) is caught only here.
supabase.auth.onAuthStateChange((_event, session) => {
  const user = session?.user.id ?? null;
  if (user === owner) return;
  if (owner !== null) clearSignedUrls();
  owner = user;
});

/** A link already in hand, so a remounted image shows at once instead of flashing a placeholder. */
export function cachedUrl(bucket: string, path: string, thumb: boolean): string | null | undefined {
  hydrate();
  const hit = cache.get(keyOf(bucket, path, thumb));
  return fresh(hit, MIN_LEFT_MS) ? hit.value : undefined;
}
