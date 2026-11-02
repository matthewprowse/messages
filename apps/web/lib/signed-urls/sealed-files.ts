// Sealed files, opened in the browser. Note files are sealed before upload (lib/notes.ts), and stored attachments (email,
// WhatsApp, Instagram) are sealed by the workers (attachments.sealed), so a signed link to one would show ciphertext.
// They are fetched and decrypted here and handed out as blob links. A file uploaded before sealing began does not
// start with the sealed-file header, so its signed link is used as it is.

import { decryptBytes, decryptTeamBytes, isSealedBytes, SEALED_MAGIC_BYTES } from "@messages/crypto";
import { teamKeyRing, userKeys } from "../vault";
import { BUCKET } from "../outbox-files";
import { signedUrl } from "./links";
import { headOf, joinChunks } from "./chunks";
import { isTeamFilePath, sealedField } from "./sealed-paths";
import { thumbCache } from "./thumb-store";

const noteMimes = new Map<string, string>();

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
  if (!isSealedBytes(headOf(chunks, length, SEALED_MAGIC_BYTES))) {
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
  const plain = await openSealed(path, joinChunks(chunks, length));
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

// A sealed photo is encrypted, so Storage cannot resize it. The worker stores a small sealed copy beside it
// (attachments.thumb_path, about 15 KB). Tiles open that instead of the whole photo, and the opened picture is kept
// by attachment id for the session, so scrolling away and back downloads nothing.
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
