"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { CalendarDays, File, FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, Presentation, RotateCcw, ZoomIn, ZoomOut, type LucideIcon } from "lucide-react";
import { useApp } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { signedUrl, useSignedUrl } from "@/lib/signed-urls";
import type { Attachment, FiledAttachment } from "@/lib/types";
import { relTime, stampOf } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { PdfThumbnail, PdfViewer } from "@/components/pdf-viewer";

export const KIND_LABEL: Record<Attachment["kind"], string> = { image: "Image", pdf: "PDF", video: "Video", file: "File" };

export const HIDDEN_LABEL: Record<NonNullable<Attachment["hiddenReason"]>, string> = {
  inline: "Inline Image",
  tiny: "Tiny Image",
  junk: "From Junk",
  manual: "Hidden",
};

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
  const url = useSignedUrl(BUCKET, pictured && seen ? a.path : undefined);
  const [broken, setBroken] = useState(false);
  const onError = useCallback(() => setBroken(true), []);
  if (!pictured || broken || (seen && url === null)) return <FileGlyph attachment={a} />;
  if (!url) return <span ref={box} className="size-full"><Skeleton className="size-full rounded-none" /></span>;
  if (a.kind === "pdf") return <PdfThumbnail cacheKey={a.id} url={url} name={a.name} onError={onError} />; // pdf.js loads here, once on screen
  // Images some browsers cannot draw (HEIC outside Safari) fall back to the icon.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={a.name} decoding="async" onError={onError} className="size-full object-cover" />;
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

export function AttachmentTile({ attachment: a, onOpen, className, showName = true }: { attachment: Attachment; onOpen: () => void; className?: string; showName?: boolean }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${a.name}`}
      title={a.name}
      className={cn("relative flex size-24 overflow-hidden rounded-lg bg-muted text-left outline-none ring-1 ring-foreground/5 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/50", className)}
    >
      <Thumb attachment={a} />
      {a.hiddenReason && (
        <Badge variant="secondary" className="absolute top-1.5 left-1.5">{HIDDEN_LABEL[a.hiddenReason]}</Badge>
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

type StoredFile = { id: string; state: "loading" } | { id: string; state: "missing" } | { id: string; state: "ready"; view: string; download: string };

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
    setFile((f) => (f?.id === id && f.state === "ready" ? f : { id, state: "loading" }));
    (async (): Promise<StoredFile> => {
      let path = knownPath;
      if (!path) {
        const { data } = await supabase.from("attachments").select("storage_path").eq("id", id).maybeSingle();
        path = data?.storage_path ?? undefined;
      }
      const view = path ? await signedUrl(BUCKET, path, VIEW_MIN_LEFT_MS) : null;
      return view ? { id, state: "ready", view, download: downloadLink(view, name) } : { id, state: "missing" };
    })()
      .then((next) => { if (!cancelled) setFile(next); })
      .catch(() => { if (!cancelled) setFile({ id, state: "missing" }); });
    return () => { cancelled = true; };
  }, [id, knownPath, name, open]);
  return file?.id === id ? file : null;
}

const IMAGE_MAX_ZOOM = 8;

/** An image that zooms (buttons, wheel, double click, plus and minus keys) and pans by dragging. */
function ImageViewer({ url, name, onBroken }: { url: string; name: string; onBroken: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const frame = useRef<HTMLDivElement>(null);

  const zoomTo = useCallback((next: number) => {
    const z = Math.min(IMAGE_MAX_ZOOM, Math.max(1, next));
    setZoom(z);
    if (z === 1) setOffset({ x: 0, y: 0 });
    else setOffset((o) => ({ x: (o.x * z) / zoom, y: (o.y * z) / zoom }));
  }, [zoom]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "+" || e.key === "=") zoomTo(zoom * 1.5);
      else if (e.key === "-") zoomTo(zoom / 1.5);
      else if (e.key === "0") zoomTo(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom, zoomTo]);

  // The wheel listener is not passive, so zooming does not also scroll the page behind the dialog.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomTo(zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom, zoomTo]);

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={frame}
        className={cn("relative h-[min(70vh,calc(100dvh-15rem))] min-h-64 touch-none overflow-hidden rounded-lg bg-muted select-none", zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in")}
        onDoubleClick={() => zoomTo(zoom > 1 ? 1 : 2.5)}
        onPointerDown={(e) => {
          if (zoom === 1) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) setOffset({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y });
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name}
          draggable={false}
          onError={onBroken}
          className="size-full object-contain"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`, transition: drag.current ? "none" : "transform 80ms" }}
        />
      </div>
      <div className="flex items-center justify-center gap-1">
        <Button variant="ghost" size="icon-sm" aria-label="Zoom Out" title="Zoom Out" disabled={zoom <= 1} onClick={() => zoomTo(zoom / 1.5)}><ZoomOut /></Button>
        <span className="w-11 text-center text-xs text-muted-foreground tabular-nums">{Math.round(zoom * 100)}%</span>
        <Button variant="ghost" size="icon-sm" aria-label="Zoom In" title="Zoom In" disabled={zoom >= IMAGE_MAX_ZOOM} onClick={() => zoomTo(zoom * 1.5)}><ZoomIn /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Fit" title="Fit" disabled={zoom === 1} onClick={() => zoomTo(1)}><RotateCcw /></Button>
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

type ViewerProps = { attachment: Attachment | null; detail?: string; href?: string; onClose: () => void };

// Opens any attachment. PDFs open in the built-in viewer, images zoom and pan, videos play, and other
// files can be downloaded. Given an href, it also links to the message the file came with.
export function AttachmentViewer({ attachment, ...rest }: ViewerProps) {
  // A conversation has one of these per message and most never open, so the dialog mounts on first
  // open. The last file stays shown while the dialog animates closed.
  const [last, setLast] = useState<Attachment | null>(null);
  if (attachment && attachment !== last) setLast(attachment);
  return last ? <ViewerDialog attachment={last} open={!!attachment} {...rest} /> : null;
}

function ViewerDialog({ attachment: a, open, detail, href, onClose }: Omit<ViewerProps, "attachment"> & { attachment: Attachment; open: boolean }) {
  const file = useStoredFile(a, open);
  const [broken, setBroken] = useState<string | null>(null); // id of an image the browser could not draw
  const notStored = a.hiddenReason === "tiny" || a.hiddenReason === "junk";
  const wide = file?.state === "ready" && (a.kind === "pdf" || a.kind === "image");

  let body: ReactNode;
  if (!file || file.state === "loading") body = <Skeleton className="aspect-video w-full rounded-lg" />;
  else if (file.state === "missing")
    body = <NoPreview attachment={a} message={notStored ? "Not Kept Here. The Original Is in Your Mailbox." : "This File Is Still Downloading"} />;
  else if (a.kind === "pdf") body = <PdfViewer key={a.id} url={file.view} name={a.name} />;
  else if (a.kind === "image" && broken !== a.id) body = <ImageViewer key={a.id} url={file.view} name={a.name} onBroken={() => setBroken(a.id)} />;
  else if (a.kind === "video") body = <video src={file.view} controls className="max-h-[min(70vh,calc(100dvh-15rem))] w-full rounded-lg bg-muted" />;
  else body = <NoPreview attachment={a} message="No Preview Available" />;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className={cn("max-h-[calc(100dvh-2rem)] grid-cols-1 overflow-y-auto sm:max-w-3xl", wide && "sm:max-w-5xl")}>
        <div className="min-w-0">
          <DialogTitle className="truncate">{a.name}</DialogTitle>
          <DialogDescription>{[KIND_LABEL[a.kind], a.size, detail].filter(Boolean).join(" · ")}</DialogDescription>
        </div>
        <div className="min-w-0">{body}</div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {href && (
            <Button variant="outline" asChild><Link href={href}>Show in Conversation</Link></Button>
          )}
          {file?.state === "ready" ? (
            <Button asChild><a href={file.download} download={a.name}>Download</a></Button>
          ) : (
            <Button disabled>Download</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export const messageHref = (a: FiledAttachment) => `/inbox/${a.threadId}?message=${a.messageId}`;

/** Files gathered from many messages, newest first, each captioned with its name, who sent it and when. */
export function AttachmentGrid({ items, hrefFor = messageHref, className }: { items: FiledAttachment[]; hrefFor?: (a: FiledAttachment) => string; className?: string }) {
  const { contactById } = useApp();
  const [viewing, setViewing] = useState<FiledAttachment | null>(null);
  const who = (from: string) => (from === "me" ? "You" : contactById(from)?.name ?? "Unknown");
  return (
    <>
      <div className={cn("grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-x-3 gap-y-4", className)}>
        {items.map((a) => (
          <div key={a.id} className={cn("flex min-w-0 flex-col gap-1", a.hiddenReason && "opacity-60")}>
            <AttachmentTile attachment={a} onOpen={() => setViewing(a)} showName={false} className="aspect-square size-auto w-full" />
            <span className="truncate px-0.5 text-xs font-medium" title={a.name}>{a.name}</span>
            <span className="truncate px-0.5 text-xs text-muted-foreground">{who(a.from)} · {relTime(a.sentAt)} · {a.size}</span>
          </div>
        ))}
      </div>
      <AttachmentViewer
        attachment={viewing}
        detail={viewing ? `${who(viewing.from)}, ${stampOf(viewing.sentAt)}` : undefined}
        href={viewing ? hrefFor(viewing) : undefined}
        onClose={() => setViewing(null)}
      />
    </>
  );
}
