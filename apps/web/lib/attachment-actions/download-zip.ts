"use client";

// Download Selected: fetches each chosen file (opening sealed ones in the browser, as the viewer does), packs them into a
// ZIP (zip.ts) and saves it. Files with no stored copy are skipped and counted. A few are fetched at a time, and the
// total is capped so a phone is not asked to hold gigabytes.

import { ATTACHMENT_BUCKET as BUCKET } from "../attachment-view";
import { acquireNoteFile, signedUrl } from "../signed-urls";
import type { FiledAttachment } from "../types";
import { buildZip, fitsZip, zipEntryNames, zipFileName, type ZipOutcome } from "./zip";

const PARALLEL = 3;
/** The most a zip is built from in the browser's memory. */
export const ZIP_MEMORY_BYTES = 500 * 1024 * 1024;

/** One file's bytes, or null when it cannot be had. */
async function bytesOf(a: FiledAttachment): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!a.path) return null;
  if (a.sealed) {
    const handle = acquireNoteFile(a.path);
    try {
      const opened = await handle.promise;
      if (!opened || opened.tooLarge) return null;
      return new Uint8Array(await (await fetch(opened.url)).arrayBuffer());
    } finally {
      handle.release();
    }
  }
  const link = await signedUrl(BUCKET, a.path);
  if (!link) return null;
  const res = await fetch(link);
  return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
}

/** Builds and saves the zip. Resolves with what happened so the page can say it in a sentence. */
export async function downloadZip(files: FiledAttachment[], now = new Date()): Promise<ZipOutcome> {
  const stored = files.filter((f) => !!f.path);
  const skipped = files.length - stored.length;
  if (stored.length === 0) return { saved: 0, skipped, failed: 0, reason: "none" };
  const expected = stored.reduce((n, f) => n + (f.bytes ?? 0), 0);
  if (!fitsZip(stored.length, expected) || expected > ZIP_MEMORY_BYTES) return { saved: 0, skipped, failed: 0, reason: "too_big" };

  const got: (Uint8Array<ArrayBuffer> | null)[] = new Array(stored.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PARALLEL, stored.length) }, async () => {
    while (next < stored.length) {
      const i = next++;
      got[i] = await bytesOf(stored[i]).catch(() => null);
    }
  }));
  const kept = stored.flatMap((f, i) => (got[i] ? [{ file: f, data: got[i]! }] : []));
  const failed = stored.length - kept.length;
  if (kept.length === 0) return { saved: 0, skipped, failed };

  const names = zipEntryNames(kept.map((k) => k.file.name));
  const blob = buildZip(kept.map((k, i) => ({ name: names[i], data: k.data })), now);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = zipFileName(now);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000); // after the browser has started the save
  return { saved: kept.length, skipped, failed };
}
