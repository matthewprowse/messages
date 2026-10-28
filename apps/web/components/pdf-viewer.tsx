"use client";

// PDF rendering with pdf.js: first-page thumbnails for tiles (cached, loaded a few at a time) and the full viewer.

import { useCallback, useEffect, useRef, useState, type RefObject, type TouchEvent as ReactTouchEvent } from "react";
import { ArrowLeft, ArrowRight, MoveHorizontal, ZoomIn, ZoomOut } from "lucide-react";
import { openPdf, renderPage, type PDFDocumentProxy } from "@/lib/pdf";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const THUMB_WIDTH = 240;
// Each first page is a data URL of a few KB, so only the 200 most recently used are kept.
const THUMB_CACHE_MAX = 200;
const thumbs = new Map<string, Promise<string>>();

// At most three PDFs open at once for thumbnails, so a full grid does not download every file together.
let opening = 0;
const queue: (() => void)[] = [];
async function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  if (opening >= 3) await new Promise<void>((resolve) => queue.push(resolve));
  opening++;
  try {
    return await work();
  } finally {
    opening--;
    queue.shift()?.();
  }
}

function firstPageImage(key: string, url: string): Promise<string> {
  let made = thumbs.get(key);
  if (made) {
    // Re-insert so the Map's order is least recently used first.
    thumbs.delete(key);
    thumbs.set(key, made);
  } else {
    made = oneAtATime(async () => {
      const doc = await openPdf(url);
      try {
        const page = await doc.getPage(1);
        const canvas = document.createElement("canvas");
        await renderPage(page, canvas, THUMB_WIDTH).promise;
        return canvas.toDataURL("image/jpeg", 0.85);
      } finally {
        void doc.loadingTask.destroy();
      }
    });
    made.catch(() => thumbs.delete(key));
    thumbs.set(key, made);
    while (thumbs.size > THUMB_CACHE_MAX) thumbs.delete(thumbs.keys().next().value as string);
  }
  return made;
}

/** The first page of a PDF. Mount it only once on screen: drawing it loads pdf.js and the file's start. */
export function PdfThumbnail({ cacheKey, url, className, onError, onReady }: { cacheKey: string; url: string; name?: string; className?: string; onError: () => void; /** Called once the first page is drawn. */ onReady?: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const failed = useRef(onError);
  useEffect(() => { failed.current = onError; });

  useEffect(() => {
    let cancelled = false;
    firstPageImage(cacheKey, url).then(
      (image) => { if (!cancelled) { setSrc(image); onReady?.(); } },
      () => { if (!cancelled) failed.current(); },
    );
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, url]);

  return (
    <div className={cn("size-full", className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full bg-white object-cover object-top" />
      ) : (
        <Skeleton className="size-full rounded-none" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The full viewer
// ---------------------------------------------------------------------------

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;

/** A built-in PDF viewer: one page at a time, page thumbnails, zoom, fit to width and arrow keys. */
export function PdfViewer({ url, name }: { url: string; name: string }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);
  // 1 is the page fitted to the width of the view; zooming multiplies that.
  const [zoom, setZoom] = useState(1);
  const [actual, setActual] = useState<number | null>(null); // shown size against the page's real size
  const [width, setWidth] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    let opened: PDFDocumentProxy | null = null;
    setDoc(null);
    setFailed(false);
    setPage(1);
    setZoom(1);
    openPdf(url).then(
      (d) => {
        opened = d;
        if (cancelled) void d.loadingTask.destroy();
        else setDoc(d);
      },
      (err) => {
        console.error(err);
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
      if (opened) void opened.loadingTask.destroy();
    };
  }, [url]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = new ResizeObserver(() => setWidth(el.clientWidth));
    measure.observe(el);
    setWidth(el.clientWidth);
    return () => measure.disconnect();
  }, [doc]);

  useEffect(() => {
    if (!doc || !canvas.current || width === 0) return;
    let cancelled = false;
    let task: ReturnType<typeof renderPage> | null = null;
    (async () => {
      const p = await doc.getPage(page);
      if (cancelled || !canvas.current) return;
      const cssWidth = Math.max(100, (width - 32) * zoom);
      setActual(cssWidth / p.getViewport({ scale: 1 }).width);
      task = renderPage(p, canvas.current, cssWidth);
      await task.promise;
    })().catch((err: unknown) => {
      if ((err as { name?: string })?.name !== "RenderingCancelledException") console.error(err);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page, width, zoom]);

  const pages = doc?.numPages ?? 0;
  const go = useCallback((n: number) => {
    setPage((current) => {
      const next = Math.min(Math.max(1, n), pages || 1);
      if (next !== current) scroller.current?.scrollTo({ top: 0 });
      return next;
    });
  }, [pages]);
  // On a phone the page strip is hidden, so a horizontal swipe on an unzoomed page turns it.
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: ReactTouchEvent) => {
    touch.current = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  };
  const onTouchEnd = (e: ReactTouchEvent) => {
    const start = touch.current;
    touch.current = null;
    const el = scroller.current;
    if (!start || !el || window.matchMedia("(min-width: 40rem)").matches || el.scrollWidth > el.clientWidth + 1) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(page + (dx < 0 ? 1 : -1));
  };
  const zoomBy = useCallback((factor: number) => setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor))), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable=true]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") go(page + 1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") go(page - 1);
      else if (e.key === "Home") go(1);
      else if (e.key === "End") go(pages);
      else if (e.key === "+" || e.key === "=") zoomBy(ZOOM_STEP);
      else if (e.key === "-") zoomBy(1 / ZOOM_STEP);
      else if (e.key === "0") setZoom(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, page, pages, zoomBy]);

  if (failed) {
    return (
      <div className="flex h-[calc(100dvh-10rem)] min-h-64 items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
        This PDF Did Not Open. Download It Instead.
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-13rem)] min-h-64 flex-col gap-2">
      <div className="flex min-h-0 flex-1 gap-2">
        {doc && pages > 1 && <PageStrip doc={doc} current={page} onPick={go} />}
        <div ref={scroller} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className="min-w-0 flex-1 overflow-auto rounded-lg bg-muted p-4">
          {!doc && <Skeleton className="mx-auto aspect-[1/1.414] w-full max-w-xl" />}
          <canvas ref={canvas} aria-label={`${name}, page ${page}`} className={cn("mx-auto bg-white shadow-sm", !doc && "hidden")} />
        </div>
      </div>
      {/* Fit on the left, zoom in the middle and the pages on the right, as under a picture. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center">
        <Button variant="ghost" size="icon" className="justify-self-start" aria-label="Fit to Width" title="Fit to Width" disabled={zoom === 1} onClick={() => setZoom(1)}><MoveHorizontal /></Button>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Zoom Out" title="Zoom Out" disabled={zoom <= MIN_ZOOM} onClick={() => zoomBy(1 / ZOOM_STEP)}><ZoomOut /></Button>
          <span className="w-11 text-center text-xs text-muted-foreground tabular-nums">{actual ? `${Math.round(actual * 100)}%` : ""}</span>
          <Button variant="ghost" size="icon" aria-label="Zoom In" title="Zoom In" disabled={zoom >= MAX_ZOOM} onClick={() => zoomBy(ZOOM_STEP)}><ZoomIn /></Button>
        </div>
        <div className="flex items-center gap-1 justify-self-end">
          <Button variant="ghost" size="icon" aria-label="Previous Page" title="Previous Page" disabled={page <= 1} onClick={() => go(page - 1)}><ArrowLeft /></Button>
          <span className="min-w-16 text-center text-xs text-muted-foreground tabular-nums">{pages ? `${page} of ${pages}` : "Loading"}</span>
          <Button variant="ghost" size="icon" aria-label="Next Page" title="Next Page" disabled={!pages || page >= pages} onClick={() => go(page + 1)}><ArrowRight /></Button>
        </div>
      </div>
    </div>
  );
}

/** Page thumbnails down the side, drawn as they scroll into view. Hidden on narrow screens. */
function PageStrip({ doc, current, onPick }: { doc: PDFDocumentProxy; current: number; onPick: (page: number) => void }) {
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    strip.current?.querySelector(`[data-page="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);
  return (
    <div ref={strip} className="hidden w-24 shrink-0 flex-col gap-2 overflow-y-auto pr-1 sm:flex" aria-label="Pages">
      {Array.from({ length: doc.numPages }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          data-page={n}
          onClick={() => onPick(n)}
          aria-label={`Page ${n}`}
          aria-current={n === current ? "page" : undefined}
          className={cn(
            "flex flex-col items-center gap-1 rounded-md p-1 text-[11px] text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50",
            n === current && "bg-accent text-foreground",
          )}
        >
          <PageThumb doc={doc} page={n} root={strip} />
          {n}
        </button>
      ))}
    </div>
  );
}

function PageThumb({ doc, page, root }: { doc: PDFDocumentProxy; page: number; root: RefObject<HTMLDivElement | null> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let cancelled = false;
    let task: ReturnType<typeof renderPage> | null = null;
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      seen.disconnect();
      doc.getPage(page)
        .then((p) => {
          if (cancelled) return;
          task = renderPage(p, el, 80);
          return task.promise.then(() => { if (!cancelled) setDrawn(true); });
        })
        .catch(() => {});
    }, { root: root.current, rootMargin: "300px" });
    seen.observe(el);
    return () => { cancelled = true; seen.disconnect(); task?.cancel(); };
  }, [doc, page, root]);
  return (
    <span className="relative block w-20">
      {!drawn && <Skeleton className="absolute inset-0 rounded-sm" />}
      <canvas ref={canvas} className={cn("block w-20 rounded-sm bg-white shadow-sm", !drawn && "h-28")} />
    </span>
  );
}
