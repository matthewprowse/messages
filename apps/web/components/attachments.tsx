"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { track } from "@/lib/analytics";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Cloud, File, FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, Mail, MessageCircle, Presentation, RotateCcw, ZoomIn, ZoomOut, type LucideIcon } from "lucide-react";
import { useApp } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { acquireNoteFile, downloadUrl, isNotePath, reportThumb, signedUrl, thumbsEnabled, useSignedUrl } from "@/lib/signed-urls";
import type { Attachment, FiledAttachment, Provider } from "@/lib/types";
import { relTime, stampOf } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { PdfThumbnail, PdfViewer } from "@/components/pdf-viewer";
import { VideoPlayer, VoiceNote } from "@/components/media-player";

export const KIND_LABEL: Record<Attachment["kind"], string> = { image: "Image", pdf: "PDF", video: "Video", audio: "Audio", file: "File" };

export const HIDDEN_LABEL: Record<NonNullable<Attachment["hiddenReason"]>, string> = {
  inline: "Inline Image",
  tiny: "Tiny Image",
  junk: "From Junk",
  manual: "Hidden",
};

/** Where a file came from, for the filter and the icon on a tile. */
export type Source = "gmail" | "whatsapp" | "icloud" | "imap";
export const SOURCE_LABEL: Record<Source, string> = { gmail: "Gmail", whatsapp: "WhatsApp", icloud: "iCloud", imap: "Other Email" };
const SOURCE_ICON: Record<Source, LucideIcon> = { gmail: Mail, whatsapp: MessageCircle, icloud: Cloud, imap: Mail };

export function sourceOf(provider: Provider | undefined): Source | undefined {
  return provider === "gmail" || provider === "whatsapp" || provider === "icloud" || provider === "imap" ? provider : undefined;
}

const BUCKET = "attachments";
// The viewer wants a link with half its hour left, so a video or long PDF kept open keeps working.
const VIEW_MIN_LEFT_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Tiles and thumbnails
// ---------------------------------------------------------------------------

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot > name.length - 7 ? name.slice(dot + 1).toUpperCase() : "";
}

function iconFor(a: Attachment): LucideIcon {
  const ext = extensionOf(a.name).toLowerCase();
  if (a.kind === "image") return FileImage;
  if (a.kind === "video") return FileVideo;
  if (a.kind === "audio") return FileAudio;
  if (a.kind === "pdf" || ["doc", "docx", "rtf", "txt", "odt", "pages", "md"].includes(ext)) return FileText;
  if (["xls", "xlsx", "csv", "numbers", "ods"].includes(ext)) return FileSpreadsheet;
  if (["ppt", "pptx", "key", "odp"].includes(ext)) return Presentation;
  if (["zip", "rar", "7z", "gz", "tar"].includes(ext)) return FileArchive;
  if (["mp3", "m4a", "wav", "aac", "ogg"].includes(ext)) return FileAudio;
  if (ext === "ics") return CalendarDays;
  return File;
}

/** A clean tile for files without a picture: the file type's icon, its extension and size. */
function FileGlyph({ attachment: a, large }: { attachment: Attachment; large?: boolean }) {
  const Icon = iconFor(a);
  const ext = extensionOf(a.name) || KIND_LABEL[a.kind];
  return (
    <span className="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground">
      <Icon className={large ? "size-12" : "size-7"} strokeWidth={1.5} />
      <span className={cn("font-medium", large ? "text-sm" : "text-[11px]")}>{ext}</span>
      {large && <span className="text-xs">{a.size}</span>}
    </span>
  );
}

// One observer shared by every tile, rather than one each, for grids of hundreds of files.
const seenCallbacks = new Map<Element, () => void>();
let observer: IntersectionObserver | null = null;

function whenSeen(el: Element, callback: () => void) {
  observer ??= new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      seenCallbacks.get(e.target)?.();
      seenCallbacks.delete(e.target);
      observer?.unobserve(e.target);
    }
  }, { rootMargin: "300px" });
  seenCallbacks.set(el, callback);
  observer.observe(el);
  return () => {
    seenCallbacks.delete(el);
    observer?.unobserve(el);
  };
}

/** True once the element has come near the visible area. Never goes back to false. */
function useSeen(ref: RefObject<HTMLElement | null>) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    return whenSeen(el, () => setSeen(true));
  }, [ref, seen]);
  return seen;
}

/** The picture inside a tile: the image itself, a PDF's first page, or the file type's icon. */
function Thumb({ attachment: a }: { attachment: Attachment }) {
  const pictured = !!a.path && (a.kind === "image" || a.kind === "pdf");
  // Links are only asked for, and images only downloaded, once a tile scrolls near the screen.
  // The browser's own lazy loading is not used: it does not fire in every webview.
  const box = useRef<HTMLSpanElement>(null);
  const seen = useSeen(box);
  // Images load as small resized copies. If one will not load that way, the original is tried before giving up.
  const [stage, setStage] = useState<"small" | "original">("small");
  const fellBack = useRef(false);
  // Note files are sealed, so they have no resized copies: the picture comes from the opened file.
  const small = a.kind === "image" && stage === "small" && thumbsEnabled() && !isNotePath(a.path);
  const url = useSignedUrl(BUCKET, pictured && seen ? a.path : undefined, small);
  const [broken, setBroken] = useState(false);
  const onError = useCallback(() => setBroken(true), []);
  if (!pictured || broken || (seen && url === null)) return <FileGlyph attachment={a} />;
  if (!url) return <span ref={box} className="size-full"><Skeleton className="size-full rounded-none" /></span>;
  if (a.kind === "pdf") return <PdfThumbnail cacheKey={a.id} url={url} name={a.name} onError={onError} />; // pdf.js loads here, once on screen
  // Images some browsers cannot draw (HEIC outside Safari) fall back to the icon.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      decoding="async"
      onLoad={() => {
        if (small) reportThumb("loaded");
        else if (fellBack.current) { fellBack.current = false; reportThumb("fell-back"); }
      }}
      onError={() => {
        if (small) { fellBack.current = true; setStage("original"); }
        else onError();
      }}
      className="size-full object-cover"
    />
  );
}

/** A WhatsApp sticker, stored as Sticker.webp and the like. */
export function isSticker(a: Attachment) {
  return a.kind === "image" && a.name.startsWith("Sticker.");
}

/** A sticker as WhatsApp shows it: the picture alone, about 120px, with no tile, frame or name. */
export function StickerImage({ attachment: a, onOpen }: { attachment: Attachment; onOpen: () => void }) {
  const box = useRef<HTMLButtonElement>(null);
  const seen = useSeen(box);
  const url = useSignedUrl(BUCKET, seen ? a.path : undefined);
  return (
    <button ref={box} type="button" onClick={onOpen} aria-label="Open Sticker" className="size-30 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="Sticker" decoding="async" className="size-full object-contain" /> : <Skeleton className="size-full rounded-lg" />}
    </button>
  );
}

export function AttachmentTile({ attachment: a, onOpen, className, showName = true, source }: { attachment: Attachment; onOpen: () => void; className?: string; showName?: boolean; source?: Source }) {
  const SourceIcon = source ? SOURCE_ICON[source] : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${a.name}`}
      title={a.name}
      className={cn("relative flex size-24 overflow-hidden rounded-lg bg-muted text-left outline-none ring-1 ring-foreground/5 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/50", className)}
    >
      {/* Only the picture dims for a hidden file; its badge stays readable. */}
      <span className={cn("flex size-full", a.hiddenReason && "opacity-60")}><Thumb attachment={a} /></span>
      {a.hiddenReason && (
        <Badge variant="secondary" className="absolute top-1.5 left-1.5">{HIDDEN_LABEL[a.hiddenReason]}</Badge>
      )}
      {source && SourceIcon && (
        <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-background/80 text-muted-foreground backdrop-blur-sm" title={SOURCE_LABEL[source]}>
          <SourceIcon className="size-3" aria-hidden />
          <span className="sr-only">{SOURCE_LABEL[source]}</span>
        </span>
      )}
      {showName && (
        <span className="absolute inset-x-0 bottom-0 truncate bg-background/80 px-2 py-1 text-[11px] backdrop-blur-sm">{a.name}</span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// The viewer
// ---------------------------------------------------------------------------

// sealed: a note file opened in the browser, so view and download are blob links rather than signed ones.
type StoredFile = { id: string; state: "loading" } | { id: string; state: "missing" } | { id: string; state: "ready"; path: string; view: string; download: string; sealed: boolean };

// The download link is the viewing link told to save under the file's own name, so opening a file
// costs one batched signed link (often already cached by its thumbnail) and no second request.
function downloadLink(view: string, name: string) {
  const url = new URL(view);
  url.searchParams.set("download", name);
  return url.toString();
}

// Asked for again on each open (usually from cache), so a link kept from an earlier open has time left.
function useStoredFile(a: Attachment, open: boolean): StoredFile | null {
  const [file, setFile] = useState<StoredFile | null>(null);
  // Keyed on the fields used, so a store refresh that rebuilds the attachment object does not reload it.
  const { id, path: knownPath, name } = a;
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let release: (() => void) | undefined;
    setFile((f) => (f?.id === id && f.state === "ready" ? f : { id, state: "loading" }));
    (async (): Promise<StoredFile> => {
      let path = knownPath;
      if (!path) {
        const { data } = await supabase.from("attachments").select("storage_path").eq("id", id).maybeSingle();
        path = data?.storage_path ?? undefined;
      }
      if (isNotePath(path)) {
        // A note file is opened here: sealed ones are unsealed in the browser and held until the viewer closes.
        const handle = acquireNoteFile(path);
        release = handle.release;
        if (cancelled) release();
        const opened = await handle.promise;
        if (!opened) return { id, state: "missing" };
        return { id, state: "ready", path, view: opened.url, download: opened.sealed ? opened.url : downloadLink(opened.url, name), sealed: opened.sealed };
      }
      const view = path ? await signedUrl(BUCKET, path, VIEW_MIN_LEFT_MS) : null;
      return path && view ? { id, state: "ready", path, view, download: downloadLink(view, name), sealed: false } : { id, state: "missing" };
    })()
      .then((next) => { if (!cancelled) setFile(next); })
      .catch(() => { if (!cancelled) setFile({ id, state: "missing" }); });
    return () => { cancelled = true; release?.(); };
  }, [id, knownPath, name, open]);
  return file?.id === id ? file : null;
}

const IMAGE_MAX_ZOOM = 8;
const SWIPE_MIN = 60;

/** -1 (previous) or 1 (next) for a quick, mostly horizontal drag, otherwise 0. */
function swipeOf(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}

/**
 * An image that zooms (buttons, wheel, double click, pinch, plus and minus keys) and pans by dragging.
 * A swipe while it is not zoomed goes to the neighbouring file.
 */
function ImageViewer({ url, name, onBroken, onSwipe }: { url: string; name: string; onBroken: () => void; onSwipe?: (direction: -1 | 1) => void }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  // The zoom and offset as last set, so several events in one frame build on each other rather than on a stale render.
  const current = useRef(1);
  const offsetNow = useRef({ x: 0, y: 0 });
  // Fingers on the image, for pinching, and where a one-finger touch began, for swiping.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const multi = useRef(false);

  const moveTo = useCallback((o: { x: number; y: number }) => {
    offsetNow.current = o;
    setOffset(o);
  }, []);
  const zoomTo = useCallback((next: number) => {
    const prev = current.current;
    const z = Math.min(IMAGE_MAX_ZOOM, Math.max(1, next));
    current.current = z;
    setZoom(z);
    const o = offsetNow.current;
    moveTo(z === 1 ? { x: 0, y: 0 } : { x: (o.x * z) / prev, y: (o.y * z) / prev });
  }, [moveTo]);
  const zoomBy = useCallback((factor: number) => zoomTo(current.current * factor), [zoomTo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "+" || e.key === "=") zoomBy(1.5);
      else if (e.key === "-") zoomBy(1 / 1.5);
      else if (e.key === "0") zoomTo(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomBy, zoomTo]);

  // The wheel listener is not passive, so zooming does not also scroll the page behind the dialog.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  const release = (e: ReactPointerEvent<HTMLDivElement>) => {
    const wasSingle = pointers.current.size === 1;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 1 && current.current > 1) {
      // One finger lifted from a pinch: carry on panning with the other without a jump.
      const [rest] = [...pointers.current.values()];
      drag.current = { x: rest.x, y: rest.y, ox: offsetNow.current.x, oy: offsetNow.current.y };
    } else drag.current = null;
    const start = swipe.current;
    swipe.current = null;
    if (e.type === "pointerup" && wasSingle && !multi.current && start && current.current === 1) {
      const direction = swipeOf(e.clientX - start.x, e.clientY - start.y);
      if (direction) onSwipe?.(direction);
    }
    if (pointers.current.size === 0) multi.current = false;
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={frame}
        className={cn("relative h-[min(70vh,calc(100dvh-15rem))] min-h-64 touch-none overflow-hidden rounded-lg bg-muted select-none", zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in")}
        onDoubleClick={() => zoomTo(current.current > 1 ? 1 : 2.5)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 2) {
            const [p, q] = [...pointers.current.values()];
            pinch.current = { dist: Math.hypot(p.x - q.x, p.y - q.y) || 1, zoom: current.current };
            drag.current = null;
            swipe.current = null;
            multi.current = true;
          } else if (pointers.current.size === 1) {
            multi.current = false;
            swipe.current = e.pointerType === "touch" ? { x: e.clientX, y: e.clientY } : null;
            if (current.current > 1) drag.current = { x: e.clientX, y: e.clientY, ox: offsetNow.current.x, oy: offsetNow.current.y };
          }
        }}
        onPointerMove={(e) => {
          if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const pinching = pinch.current;
          if (pinching && pointers.current.size >= 2) {
            const [p, q] = [...pointers.current.values()];
            zoomTo(pinching.zoom * (Math.hypot(p.x - q.x, p.y - q.y) / pinching.dist));
            return;
          }
          const d = drag.current;
          if (d) moveTo({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y });
        }}
        onPointerUp={release}
        onPointerCancel={release}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name}
          draggable={false}
          onError={onBroken}
          className="size-full object-contain"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`, transition: drag.current || pinch.current ? "none" : "transform 80ms" }}
        />
      </div>
      <div className="flex items-center justify-center gap-1">
        <Button variant="ghost" size="icon-sm" className="max-sm:size-10" aria-label="Zoom Out" title="Zoom Out" disabled={zoom <= 1} onClick={() => zoomBy(1 / 1.5)}><ZoomOut /></Button>
        <span className="w-11 text-center text-xs text-muted-foreground tabular-nums">{Math.round(zoom * 100)}%</span>
        <Button variant="ghost" size="icon-sm" className="max-sm:size-10" aria-label="Zoom In" title="Zoom In" disabled={zoom >= IMAGE_MAX_ZOOM} onClick={() => zoomBy(1.5)}><ZoomIn /></Button>
        <Button variant="ghost" size="icon-sm" className="max-sm:size-10" aria-label="Fit" title="Fit" disabled={zoom === 1} onClick={() => zoomTo(1)}><RotateCcw /></Button>
      </div>
    </div>
  );
}

function NoPreview({ attachment: a, message }: { attachment: Attachment; message?: string }) {
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-lg bg-muted">
      <span className="h-28"><FileGlyph attachment={a} large /></span>
      {message && <span className="text-sm text-muted-foreground">{message}</span>}
    </div>
  );
}

type ViewerProps = {
  attachment: Attachment | null;
  detail?: string;
  href?: string;
  onClose: () => void;
  /** The files being browsed and the open one's place in them, for Previous and Next. */
  items?: Attachment[];
  index?: number;
  onNavigate?: (index: number) => void;
};

// Opens any attachment. PDFs open in the built-in viewer, images zoom and pan, videos play, and other
// files can be downloaded. Given an href, it also links to the message the file came with. Given the
// list it came from, it steps through it with buttons, arrow keys and swipes.
export function AttachmentViewer({ attachment, ...rest }: ViewerProps) {
  // A conversation has one of these per message and most never open, so the dialog mounts on first
  // open. The last file stays shown while the dialog animates closed.
  const [last, setLast] = useState<Attachment | null>(null);
  if (attachment && attachment !== last) setLast(attachment);
  return last ? <ViewerDialog attachment={last} open={!!attachment} {...rest} /> : null;
}

function ViewerDialog({ attachment: a, open, detail, href, onClose, items, index, onNavigate }: Omit<ViewerProps, "attachment"> & { attachment: Attachment; open: boolean }) {
  const file = useStoredFile(a, open);
  const [broken, setBroken] = useState<string | null>(null); // id of an image the browser could not draw
  const [saving, setSaving] = useState(false);
  const notStored = a.hiddenReason === "tiny" || a.hiddenReason === "junk";
  const wide = file?.state === "ready" && (a.kind === "pdf" || a.kind === "image");
  const count = items?.length ?? 0;
  const place = index !== undefined && index >= 0 && count > 1 ? index : -1;
  const canStep = place >= 0 && !!onNavigate;
  const hasPrev = canStep && place > 0;
  const hasNext = canStep && place < count - 1;
  const step = useCallback((direction: -1 | 1) => {
    if (direction < 0 ? hasPrev : hasNext) onNavigate?.(place + direction);
  }, [hasPrev, hasNext, onNavigate, place]);
  useEffect(() => {
    if (open) track("attachment_used", { action: "open", kind: a.kind });
  }, [open, a.id, a.kind]);

  // Arrow keys step through the files, except in a PDF where they turn pages, and in a video, a slider or a field.
  useEffect(() => {
    if (!open || !canStep || a.kind === "pdf") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true], [role=slider], [data-own-arrows]")) return;
      e.preventDefault();
      step(e.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, canStep, a.kind, step]);

  // Swipes on anything but a picture (which handles its own, as it also pinches) or a PDF (which turns pages).
  const touch = useRef<{ x: number; y: number } | null>(null);
  const swipeable = canStep && a.kind !== "pdf" && !(a.kind === "image" && file?.state === "ready" && broken !== a.id);

  const download = async () => {
    if (file?.state !== "ready") return;
    track("attachment_used", { action: "download", kind: a.kind });
    setSaving(true);
    // A link made for the click lives five minutes. If it cannot be made, the viewing link told to save does.
    const url = file.sealed ? file.download : (await downloadUrl(BUCKET, file.path, a.name)) ?? file.download;
    const link = document.createElement("a");
    link.href = url;
    link.download = a.name;
    document.body.append(link);
    link.click();
    link.remove();
    setSaving(false);
  };

  let body: ReactNode;
  if (!file || file.state === "loading") body = <Skeleton className="aspect-video w-full rounded-lg" />;
  else if (file.state === "missing")
    body = <NoPreview attachment={a} message={notStored ? "Not Kept Here. The Original Is in Your Mailbox." : "This File Is Still Downloading"} />;
  else if (a.kind === "pdf") body = <PdfViewer key={a.id} url={file.view} name={a.name} />;
  else if (a.kind === "image" && broken !== a.id) body = <ImageViewer key={a.id} url={file.view} name={a.name} onBroken={() => setBroken(a.id)} onSwipe={canStep ? step : undefined} />;
  else if (a.kind === "video") body = <VideoPlayer key={a.id} src={file.view} name={a.name} />;
  else if (a.kind === "audio") body = <div className="flex justify-center rounded-lg bg-muted/40 p-6"><VoiceNote attachment={{ ...a, path: file.path }} me={false} /></div>;
  else body = <NoPreview attachment={a} message="No Preview Available" />;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent track="attachment_viewer" showCloseButton={false} className={cn("max-h-[calc(100dvh-2rem)] grid-cols-1 overflow-y-auto sm:max-w-3xl", wide && "sm:max-w-5xl")}>
        <div className="min-w-0">
          <DialogTitle className="truncate">{a.name}</DialogTitle>
          <DialogDescription>{[KIND_LABEL[a.kind], a.size, detail, place >= 0 ? `${place + 1} of ${count}` : ""].filter(Boolean).join(" · ")}</DialogDescription>
        </div>
        <div
          className="min-w-0"
          onTouchStart={swipeable ? (e) => {
            const onControl = (e.target as HTMLElement).closest("[role=slider], [data-slot=slider]");
            touch.current = e.touches.length === 1 && !onControl ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
          } : undefined}
          onTouchEnd={swipeable ? (e) => {
            const start = touch.current;
            touch.current = null;
            if (!start) return;
            const direction = swipeOf(e.changedTouches[0].clientX - start.x, e.changedTouches[0].clientY - start.y);
            if (direction) step(direction);
          } : undefined}
        >
          {body}
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Close</Button></DialogClose>
          {href && (
            <Button variant="outline" asChild><Link href={href}>Show in Conversation</Link></Button>
          )}
          {file?.state === "ready" ? (
            <Button disabled={saving} onClick={() => void download()}>Download</Button>
          ) : (
            <Button disabled>Download</Button>
          )}
          {canStep && (
            <div className="flex gap-2 sm:order-first sm:mr-auto">
              <Button variant="outline" className="flex-1 sm:flex-none" disabled={!hasPrev} onClick={() => step(-1)}><ChevronLeft data-icon="inline-start" />Previous</Button>
              <Button variant="outline" className="flex-1 sm:flex-none" disabled={!hasNext} onClick={() => step(1)}>Next<ChevronRight data-icon="inline-end" /></Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const messageHref = (a: FiledAttachment) => `/inbox/${a.threadId}?message=${a.messageId}`;

// Tiles are added a page at a time as the end of the grid scrolls near, so a library of thousands
// of files does not mount thousands of tiles up front.
const GRID_PAGE = 120;

/** Calls onSeen once when it comes near the screen. Remount it (a new key) to watch again. */
function MoreSentinel({ onSeen }: { onSeen: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const seen = useSeen(box);
  const call = useRef(onSeen);
  useEffect(() => { call.current = onSeen; });
  useEffect(() => { if (seen) call.current(); }, [seen]);
  return <div ref={box} className="col-span-full h-px" aria-hidden />;
}

const monthKey = (iso: string) => iso.slice(0, 7);
const monthTitle = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "long", year: "numeric" });
export const filesLabel = (n: number) => `${n.toLocaleString()} ${n === 1 ? "File" : "Files"}`;

/**
 * Files gathered from many messages, newest first, each captioned with its name, who sent it and when,
 * with the account it came through as a small icon. With byMonth, a header with a count starts each month.
 */
export function AttachmentGrid({ items, hrefFor = messageHref, className, byMonth = false }: { items: FiledAttachment[]; hrefFor?: (a: FiledAttachment) => string; className?: string; byMonth?: boolean }) {
  const { contactById, threadById } = useApp();
  const [viewing, setViewing] = useState<FiledAttachment | null>(null);
  const [limit, setLimit] = useState(GRID_PAGE);
  const who = (from: string) => (from === "me" ? "You" : contactById(from)?.name ?? "Unknown");
  const perMonth = useMemo(() => {
    const counts = new Map<string, number>();
    if (byMonth) for (const a of items) counts.set(monthKey(a.sentAt), (counts.get(monthKey(a.sentAt)) ?? 0) + 1);
    return counts;
  }, [items, byMonth]);
  const at = viewing ? items.findIndex((a) => a.id === viewing.id) : -1;
  let month = "";
  return (
    <>
      <div className={cn("grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-x-3 gap-y-4 lg:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]", className)}>
        {items.slice(0, limit).map((a) => {
          const key = monthKey(a.sentAt);
          const header = byMonth && key !== month;
          month = key;
          return (
            <Fragment key={a.id}>
              {header && (
                <h2 className="col-span-full flex items-baseline gap-2 pt-2 first:pt-0">
                  <span className="text-sm font-medium">{monthTitle(a.sentAt)}</span>
                  <span className="text-xs text-muted-foreground">{filesLabel(perMonth.get(key) ?? 0)}</span>
                </h2>
              )}
              <div className="flex min-w-0 flex-col gap-1">
                <AttachmentTile attachment={a} onOpen={() => setViewing(a)} showName={false} source={sourceOf(threadById(a.threadId)?.provider)} className="aspect-square size-auto w-full" />
                <span className="truncate px-0.5 text-xs font-medium" title={a.name}>{a.name}</span>
                <span className="truncate px-0.5 text-xs text-muted-foreground">{who(a.from)} · {relTime(a.sentAt)} · {a.size}</span>
              </div>
            </Fragment>
          );
        })}
        {items.length > limit && <MoreSentinel key={limit} onSeen={() => setLimit((n) => n + GRID_PAGE)} />}
      </div>
      <AttachmentViewer
        attachment={viewing}
        detail={viewing ? `${who(viewing.from)}, ${stampOf(viewing.sentAt)}` : undefined}
        href={viewing ? hrefFor(viewing) : undefined}
        items={items}
        index={at}
        onNavigate={(i) => { if (items[i]) setViewing(items[i]); }}
        onClose={() => setViewing(null)}
      />
    </>
  );
}
