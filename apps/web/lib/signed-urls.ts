"use client";

// Photos and attachments live in private buckets, so each needs a short-lived signed link. Links asked
// for in the same tick (a grid of thumbnails, a list of avatars) go out as one request per bucket, and
// a link is handed out again while it has enough time left.

import { useEffect, useState } from "react";
import { decryptBytes, decryptTeamBytes, isSealedBytes, SEALED_MAGIC_BYTES } from "@messages/crypto";
import { FIELD } from "@messages/crypto/fields";
import { supabase } from "./supabase";
import { teamKeyRing, userKeys } from "./vault";
import { mimeFor } from "./file-types";
import { ThumbCache } from "./thumb-cache";

export { mimeFor };
import { BUCKET } from "./outbox-files";

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
const MIN_LEFT_MS = 10 * 60 * 1000;
/** Past this many cached links, dead ones are dropped so a long session does not keep them all. */
const SWEEP_AT = 2000;
const SWEEP_EVERY_MS = 60_000;
let lastSweep = 0;

// expires is when the link stops working, or for a failed one, when to ask again.
type Entry = { url: Promise<string | null>; expires: number; value?: string | null };

const cache = new Map<string, Entry>();
const waiting = new Map<string, Map<string, ((url: string | null) => void)[]>>(); // bucket, then path
let scheduled = false;

const keyOf = (bucket: string, path: string, thumb = false) => `${thumb ? "t\n" : ""}${bucket}\n${path}`;

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

function fresh(entry: Entry | undefined, minLeftMs: number): entry is Entry {
  if (!entry) return false;
  if (entry.value === null) return Date.now() < entry.expires;
  return entry.expires - Date.now() > minLeftMs;
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
function cachedUrl(bucket: string, path: string, thumb: boolean): string | null | undefined {
  hydrate();
  const hit = cache.get(keyOf(bucket, path, thumb));
  return fresh(hit, MIN_LEFT_MS) ? hit.value : undefined;
}

// ---------------------------------------------------------------------------
// Files attached to notes
// ---------------------------------------------------------------------------
// Note files are sealed in the browser before upload (lib/notes.ts), and stored attachments (email, WhatsApp,
// Instagram) are sealed by the workers (attachments.sealed), so a signed link to one would show ciphertext.
// They are fetched and opened here instead, and handed out as blob links. A file uploaded before sealing began
// does not start with the sealed-file header, so its signed link is used as it is.

/** A note file's path is "<user id>/notes/<note id>/<uuid>". */
export function isNotePath(path: string | undefined): path is string {
  return !!path && path.split("/")[1] === "notes";
}

const noteMimes = new Map<string, string>();

/** The field a stored object was sealed under: note files by the browser, everything else by the workers. */
export function sealedField(path: string) {
  return isNotePath(path) ? FIELD.noteFileData : FIELD.attachmentData;
}


/** A shared chat's file as the team keeps it: "team/<workspace id>/<attachment id>", sealed with the team's key. */
export function isTeamFilePath(path: string | undefined): path is string {
  return !!path && path.startsWith("team/");
}

/** Opens a sealed file: with the team's key for a team copy (the current version first, then older ones), else the user's. */
async function openSealed(path: string, sealed: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (!isTeamFilePath(path)) return decryptBytes(await userKeys(), sealedField(path), sealed);
  let last: unknown = new Error("No team key.");
  for (const keys of await teamKeyRing()) {
    try {
      return await decryptTeamBytes(keys, sealedField(path), sealed);
    } catch (err) {
      last = err; // another version
    }
  }
  throw last;
}

/** Remembers a note file's content type, which the sealed upload does not carry, for its blob link. */
export function rememberNoteMime(path: string, mime: string) {
  noteMimes.set(path, mime);
}

/** An opened note file: the link to show or save it, and whether it is a blob made here (and so revoked when done). */
export type OpenedNoteFile = { url: string; sealed: boolean };

const OPEN_PARALLEL = 4;
let opening = 0;
const openQueue: (() => void)[] = [];
/** A released blob link is kept this long, so a tile that remounts straight away reuses it. */
const BLOB_KEEP_MS = 10 * 1000;

async function openNoteFile(path: string): Promise<OpenedNoteFile | null> {
  const link = await signedUrl(BUCKET, path, 30 * 60 * 1000);
  if (!link) return null;
  const res = await fetch(link);
  if (!res.ok || !res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  while (length < SEALED_MAGIC_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array<ArrayBuffer>);
    length += value.length;
  }
  const head = new Uint8Array(Math.min(length, SEALED_MAGIC_BYTES));
  let at = 0;
  for (const c of chunks) {
    if (at >= head.length) break;
    head.set(c.subarray(0, head.length - at), at);
    at += c.length;
  }
  if (!isSealedBytes(head)) {
    // Not sealed: an older file, shown from its signed link. The rest of the download is not needed.
    await reader.cancel().catch(() => {});
    return { url: link, sealed: false };
  }
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array<ArrayBuffer>);
    length += value.length;
  }
  const sealed = new Uint8Array(length);
  at = 0;
  for (const c of chunks) {
    sealed.set(c, at);
    at += c.length;
  }
  const plain = await openSealed(path, sealed);
  return { url: URL.createObjectURL(new Blob([plain], { type: noteMimes.get(path) || "application/octet-stream" })), sealed: true };
}

async function openLimited(path: string): Promise<OpenedNoteFile | null> {
  if (opening >= OPEN_PARALLEL) await new Promise<void>((resolve) => openQueue.push(resolve));
  opening++;
  try {
    return await openNoteFile(path);
  } catch {
    return null;
  } finally {
    opening--;
    openQueue.shift()?.();
  }
}

const openedNotes = new Map<string, { promise: Promise<OpenedNoteFile | null>; refs: number; timer?: ReturnType<typeof setTimeout> }>();

/**
 * Opens a note file, sharing one download and one blob link between everything showing it. Call release
 * when done: the blob link is revoked a few seconds after the last release.
 */
export function acquireNoteFile(path: string): { promise: Promise<OpenedNoteFile | null>; release: () => void } {
  let entry = openedNotes.get(path);
  if (!entry) {
    entry = { promise: openLimited(path), refs: 0 };
    openedNotes.set(path, entry);
  }
  const held = entry;
  clearTimeout(held.timer);
  held.refs++;
  let released = false;
  return {
    promise: held.promise,
    release: () => {
      if (released) return;
      released = true;
      if (--held.refs > 0) return;
      held.timer = setTimeout(() => {
        if (held.refs > 0 || openedNotes.get(path) !== held) return;
        openedNotes.delete(path);
        void held.promise.then((o) => { if (o?.sealed) URL.revokeObjectURL(o.url); });
      }, BLOB_KEEP_MS);
    },
  };
}

// ---------------------------------------------------------------------------
// Sealed thumbnails of photos
// ---------------------------------------------------------------------------
// A sealed photo is encrypted, so Storage cannot resize it. The worker stores a small sealed copy beside it
// (attachments.thumb_path, about 15 KB). Tiles open that instead of the whole photo, and the opened picture is kept here
// by attachment id for the session, so scrolling away and back downloads nothing. Memory only: nothing decrypted is ever
// written to IndexedDB, localStorage or sessionStorage.

const thumbCache = new ThumbCache();
const thumbOpening = new Map<string, Promise<string | null>>();

/** The decrypted thumbnail of an attachment as a blob link, shared by everything showing it; null when it cannot be opened. */
export function openThumb(id: string, thumbPath: string): Promise<string | null> {
  const hit = thumbCache.get(id);
  if (hit) return Promise.resolve(hit);
  let pending = thumbOpening.get(id);
  if (!pending) {
    rememberNoteMime(thumbPath, "image/jpeg");
    pending = openLimited(thumbPath)
      .then((opened) => {
        if (!opened) return null;
        // An unsealed object comes back as its signed link: shown as it is, and not a blob to revoke or keep.
        if (opened.sealed) thumbCache.set(id, opened.url);
        return opened.url;
      })
      .finally(() => thumbOpening.delete(id));
    thumbOpening.set(id, pending);
  }
  return pending;
}

/** The thumbnail already opened for an attachment, if any. */
export const cachedThumb = (id: string) => thumbCache.get(id);

/**
 * A sealed photo's thumbnail: undefined while opening, null when there is none or it cannot be opened (the tile then
 * uses the whole file). Pass no path to stay idle.
 */
export function useThumbUrl(id: string, thumbPath: string | undefined): string | null | undefined {
  const [got, setGot] = useState<{ id: string; path: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!thumbPath || cachedThumb(id)) return;
    let live = true;
    void openThumb(id, thumbPath).then((url) => { if (live) setGot({ id, path: thumbPath, url }); });
    return () => { live = false; };
  }, [id, thumbPath]);
  if (!thumbPath) return null;
  return cachedThumb(id) ?? (got?.id === id && got.path === thumbPath ? got.url : undefined);
}

/** A note file opened for as long as the component is mounted: undefined while opening, null when it cannot be. */
function useNoteFile(path: string | undefined): OpenedNoteFile | null | undefined {
  const [got, setGot] = useState<{ path: string; file: OpenedNoteFile | null } | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    const handle = acquireNoteFile(path);
    void handle.promise.then((file) => { if (live) setGot({ path, file }); });
    return () => { live = false; handle.release(); };
  }, [path]);
  if (!path) return null;
  return got?.path === path ? got.file : undefined;
}

/**
 * A link to a stored file: undefined while asking, null when there is no path or no file. With thumb, a
 * small resized copy for grid tiles (the full file when the project cannot resize images).
 */
export function useSignedUrl(bucket: string, path: string | undefined, thumb = false, sealedType?: string): string | null | undefined {
  // sealedType is the content type of a stored attachment known to be sealed, which is opened here like a note file.
  if (path && sealedType) rememberNoteMime(path, sealedType);
  const note = bucket === BUCKET && (isNotePath(path) || (!!path && !!sealedType));
  const opened = useNoteFile(note ? path : undefined);
  const small = thumb && thumbsEnabled() && !note;
  const [got, setGot] = useState<{ key: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!path || note) return;
    let live = true;
    signedUrl(bucket, path, MIN_LEFT_MS, small).then((url) => { if (live) setGot({ key: keyOf(bucket, path, small), url }); });
    return () => { live = false; };
  }, [bucket, path, small, note]);
  if (!path) return null;
  // Note files are opened here, not signed: sealed ones come back as a blob link.
  if (note) return opened === undefined ? undefined : opened?.url ?? null;
  return got?.key === keyOf(bucket, path, small) ? got.url : cachedUrl(bucket, path, small);
}
