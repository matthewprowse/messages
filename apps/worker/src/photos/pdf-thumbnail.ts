// The first page of a PDF as a small JPEG for grid tiles, drawn by pdf.js in a worker thread (pdf-render-worker.ts),
// then shrunk and encoded by the same sharp pipeline as photos (photos/thumbnail.ts). The caller seals the bytes. Any
// PDF that cannot be drawn (not a PDF, encrypted, broken, too slow to parse) gives null and the tile keeps its file icon.

import { Worker } from "node:worker_threads";
import { makeThumbnail, THUMB_SIZE } from "./thumbnail";

/** A PDF bigger than this is left alone: parsing it costs more memory than one backfill pass should spend. */
export const PDF_THUMB_MAX_BYTES = 25 * 1024 * 1024;
/** The render thread is killed after this long, so a hostile or huge page cannot hold the worker. */
const RENDER_TIMEOUT_MS = 20_000;
/** The render thread's own heap cap, so one PDF cannot use up the worker's memory. */
const RENDER_HEAP_MB = 256;
/** Render threads at once: each may hold a parsed PDF, and the worker's container has 1.5 GB in all. */
const PARALLEL = 2;
/** pdf.js accepts a header anywhere in the first kilobyte, as Acrobat does. */
const HEADER_WINDOW_BYTES = 1024;

/** True when the bytes carry a PDF header ("%PDF-") in their first kilobyte. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.length, HEADER_WINDOW_BYTES)).includes("%PDF-");
}

/** Draws page one in a fresh worker thread as a PNG. Null on any failure, and when the thread is killed for time. */
export function renderFirstPage(bytes: Uint8Array, timeoutMs = RENDER_TIMEOUT_MS): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (png: Buffer | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void worker.terminate().catch(() => {});
      resolve(png);
    };
    // pdf.js takes ownership of the buffer it is given, so the thread gets a copy and the caller's bytes stay usable.
    const worker = new Worker(new URL("./pdf-render-worker.ts", import.meta.url), {
      workerData: { data: new Uint8Array(bytes), size: THUMB_SIZE },
      resourceLimits: { maxOldGenerationSizeMb: RENDER_HEAP_MB },
    });
    const timer = setTimeout(() => finish(null), timeoutMs);
    worker.once("message", (png: Uint8Array | null) => finish(png ? Buffer.from(png.buffer, png.byteOffset, png.byteLength) : null));
    worker.once("error", () => finish(null));
    worker.once("exit", () => finish(null));
  });
}

let running = 0;
const queue: (() => void)[] = [];

/** The first page of a PDF as a thumbnail JPEG, or null when it cannot be drawn. */
export async function makePdfThumbnail(bytes: Uint8Array): Promise<Buffer | null> {
  if (bytes.length === 0 || bytes.length > PDF_THUMB_MAX_BYTES || !looksLikePdf(bytes)) return null;
  if (running >= PARALLEL) await new Promise<void>((resolve) => queue.push(resolve));
  running++;
  let png: Buffer | null;
  try {
    png = await renderFirstPage(bytes);
  } finally {
    running--;
    queue.shift()?.();
  }
  if (!png) return null;
  return makeThumbnail(png).catch(() => null);
}
