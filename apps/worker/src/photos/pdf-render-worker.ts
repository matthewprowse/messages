// Runs in a worker thread started by pdf-thumbnail.ts: draws the first page of one PDF with pdf.js onto a Node canvas
// and posts back a PNG (or null). Kept off the main thread so a hostile PDF that keeps the parser busy can be killed
// with worker.terminate(), which a timer on the main thread cannot do to synchronous work. No relative imports, so it
// loads under tsx or Node's own type stripping alike.

import { parentPort, workerData } from "node:worker_threads";
import { createCanvas } from "@napi-rs/canvas";

const { data, size } = workerData as { data: Uint8Array; size: number };

async function render(): Promise<Buffer | null> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // OffscreenCanvas off: inside a worker thread pdf.js otherwise takes a path that never finishes drawing.
  const task = pdfjs.getDocument({ data, useSystemFonts: false, verbosity: 0, isOffscreenCanvasSupported: false });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    // Drawn at twice the final size so the downscale in sharp is smooth, and never larger than that whatever the page size.
    const viewport = page.getViewport({ scale: (size * 2) / Math.max(base.width, base.height) });
    const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff"; // a page has no background of its own, and JPEG has no transparency
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas: canvas as never, canvasContext: context as never, viewport }).promise;
    return canvas.toBuffer("image/png");
  } catch {
    return null;
  } finally {
    await task.destroy().catch(() => {});
  }
}

render().then(
  (png) => parentPort?.postMessage(png),
  () => parentPort?.postMessage(null),
);
