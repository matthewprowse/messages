"use client";

// pdf.js, loaded on first use so it stays out of the main bundle and never runs on the server.
// The legacy build carries its own polyfills, so it also works in older Safari (the PWA on iPhone).
// The worker file is emitted by the bundler next to the app (new URL with import.meta.url works in
// both Turbopack and webpack), so it always matches the library version.

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
export type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

let loading: Promise<PdfJs> | null = null;

export function loadPdfJs(): Promise<PdfJs> {
  loading ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
    return pdfjs;
  });
  loading.catch(() => { loading = null; });
  return loading;
}

// One worker thread shared by every open PDF (a grid of thumbnails would otherwise start one each).
// Destroying a document leaves a worker it was given running.
let worker: InstanceType<PdfJs["PDFWorker"]> | null = null;

/**
 * Opens a PDF from a (signed) URL, or from a decrypted file already in memory (a sealed one: its blob link is revoked a
 * few seconds after release, and pdf.js read a revoked link as "Unexpected server response (0)"). Call
 * loadingTask.destroy() on it when done.
 */
export async function openPdf(source: string | Blob) {
  const pdfjs = await loadPdfJs();
  if (!worker || worker.destroyed) worker = new pdfjs.PDFWorker();
  // pdf.js takes the bytes over (the buffer moves to its worker), so each open reads its own copy.
  if (typeof source !== "string") return pdfjs.getDocument({ data: new Uint8Array(await source.arrayBuffer()), worker }).promise;
  const url = source;
  // Thumbnails and the first page only need the start of the file; the rest loads as pages are viewed.
  // pdf.js only stops prefetching when streaming is off too. Without range support it reads the whole file.
  // pdf.js 6 removed the isEvalSupported option (it no longer evaluates font code), so there is nothing to turn off.
  return pdfjs.getDocument({ url, worker, disableAutoFetch: true, disableStream: true }).promise;
}

/**
 * Renders one page onto a canvas at the given CSS width, sharp on high-density screens.
 * Returns the render task so a newer render can cancel it.
 */
export function renderPage(page: import("pdfjs-dist/legacy/build/pdf.mjs").PDFPageProxy, canvas: HTMLCanvasElement, cssWidth: number) {
  const base = page.getViewport({ scale: 1 });
  const scale = cssWidth / base.width;
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  const viewport = page.getViewport({ scale: scale * ratio });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
  canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
  return page.render({ canvas, viewport });
}
