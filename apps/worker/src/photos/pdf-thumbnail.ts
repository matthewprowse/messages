// The first page of a PDF as a small JPEG for grid tiles, made with pdf.js and a Node canvas, then shrunk and encoded
// by the same sharp pipeline as photos (photos/thumbnail.ts). The caller seals the bytes. Any PDF that cannot be drawn
// (encrypted, broken, too slow to parse) gives null and the tile keeps its file icon.

import { createCanvas } from "@napi-rs/canvas";
import { makeThumbnail, THUMB_SIZE } from "./thumbnail";

/** A PDF bigger than this is left alone: parsing it costs more memory than one backfill pass should spend. */
export const PDF_THUMB_MAX_BYTES = 25 * 1024 * 1024;
/** Rendering gives up after this long, so a hostile or huge page cannot hold the worker. */
const RENDER_TIMEOUT_MS = 20_000;

/** The first page of a PDF as a thumbnail JPEG, or null when it cannot be drawn. */
export async function makePdfThumbnail(bytes: Uint8Array): Promise<Buffer | null> {
  if (bytes.length === 0 || bytes.length > PDF_THUMB_MAX_BYTES) return null;
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdf.js takes ownership of the buffer it is given, so it gets a copy and the caller's bytes stay usable.
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 });
  const timer = setTimeout(() => void task.destroy().catch(() => {}), RENDER_TIMEOUT_MS);
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    // Drawn at twice the final size so the downscale in sharp is smooth, and never larger than that whatever the page size.
    const viewport = page.getViewport({ scale: (THUMB_SIZE * 2) / Math.max(base.width, base.height) });
    const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff"; // a page has no background of its own, and JPEG has no transparency
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas: canvas as never, canvasContext: context as never, viewport }).promise;
    return await makeThumbnail(canvas.toBuffer("image/png"));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    await task.destroy().catch(() => {});
  }
}
