"use client";

// Everything for showing files: tiles and thumbnails, the full-screen viewer with its swipe navigation, and the grid used by the Attachments page,
// a contact's page and a conversation. Labels for kinds and sources live here too.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { track } from "@/lib/analytics";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CalendarDays, ExternalLink, File, FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, Maximize, Presentation, RotateCw, X, ZoomIn, ZoomOut, type LucideIcon } from "lucide-react";
import { useApp } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { withSealedColumns } from "@/lib/sealed-columns";
import { acquireNoteFile, downloadUrl, isNotePath, mimeFor, rememberNoteMime, reportThumb, signedUrl, thumbsEnabled, useSignedUrl } from "@/lib/signed-urls";
import type { Attachment, Contact, FiledAttachment, Provider } from "@/lib/types";
import { fullDate, stampOf } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ContactAvatar } from "@/components/primitives";
import { MyAvatar } from "@/components/my-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { PdfThumbnail, PdfViewer } from "@/components/pdf-viewer";
import { STAGE_HEIGHT, VideoPlayer, VoiceNote } from "@/components/media-player";

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
// Each service shows its own logo; other mail has none, so it gets a plain envelope.

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
  }, { rootMargin: "800px" });
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
function Thumb({ attachment: a, onReady }: { attachment: Attachment; /** Called with "picture" once a picture has loaded, or "glyph" when the tile shows the file type's icon. */ onReady?: (kind: "picture" | "glyph") => void }) {
  const pictured = !!a.path && (a.kind === "image" || a.kind === "pdf");
  // Links are only asked for, and images only downloaded, once a tile scrolls near the screen.
  // The browser's own lazy loading is not used: it does not fire in every webview.
  const box = useRef<HTMLSpanElement>(null);
  const seen = useSeen(box);
  // Images load as small resized copies. If one will not load that way, the original is tried before giving up.
  const [stage, setStage] = useState<"small" | "original">("small");
  const fellBack = useRef(false);
  // Note files and sealed attachments are encrypted, so they have no resized copies: the picture comes from the opened file.
  const small = a.kind === "image" && stage === "small" && thumbsEnabled() && !isNotePath(a.path) && !a.sealed;
  const url = useSignedUrl(BUCKET, pictured && seen ? a.path : undefined, small, a.sealed ? mimeFor(a) : undefined);
  const [broken, setBroken] = useState(false);
  const onError = useCallback(() => setBroken(true), []);
  const glyph = !pictured || broken || (seen && url === null);
  useEffect(() => { if (glyph) onReady?.("glyph"); }, [glyph, onReady]);
  if (glyph) return <FileGlyph attachment={a} />;
  if (!url) return <span ref={box} className="size-full"><Skeleton className="size-full rounded-none" /></span>;
  if (a.kind === "pdf") return <PdfThumbnail cacheKey={a.id} url={url} name={a.name} onError={onError} onReady={() => onReady?.("picture")} />; // pdf.js loads here, once on screen
  // Images some browsers cannot draw (HEIC outside Safari) fall back to the icon.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      decoding="async"
      onLoad={() => {
        onReady?.("picture");
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
  const url = useSignedUrl(BUCKET, seen ? a.path : undefined, false, a.sealed ? mimeFor(a) : undefined);
  return (
    <button ref={box} type="button" onClick={onOpen} aria-label="Open Sticker" className="size-30 overflow-hidden rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="Sticker" decoding="async" className="size-full rounded-lg object-contain" /> : <Skeleton className="size-full rounded-lg" />}
    </button>
  );
}

export function AttachmentTile({ attachment: a, onOpen, className, showName = true, source, overlay }: { attachment: Attachment; onOpen: () => void; className?: string; showName?: boolean; source?: Source; overlay?: ReactNode }) {
  // What the tile shows once it has loaded: a picture, or the file type's icon. The caption waits for either, so it never
  // sits alone over an empty box.
  const [shown, setShown] = useState<"picture" | "glyph" | null>(null);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${a.name}`}
      title={a.name}
      className={cn("group/tile relative flex size-24 overflow-hidden rounded-lg bg-muted text-left outline-none ring-1 ring-foreground/5 focus-visible:ring-2 focus-visible:ring-ring/50", className)}
    >
      {/* Only the picture dims for a hidden file; its badge stays readable. */}
      <span className={cn("flex size-full", a.hiddenReason && "opacity-60")}><Thumb attachment={a} onReady={setShown} /></span>
      {a.hiddenReason ? (
        <Badge variant="secondary" className="absolute top-1.5 left-1.5">{HIDDEN_LABEL[a.hiddenReason]}</Badge>
      ) : a.notKept && !a.path ? (
        <Badge variant="secondary" className="absolute top-1.5 left-1.5">Not Kept Here</Badge>
      ) : null}
      {source && <span className="sr-only">{SOURCE_LABEL[source]}</span>}
      {/* The sender and date show on hover; on a touch screen there is no hover, so they stay. */}
      {overlay && shown === "picture" && (
        <span className="absolute inset-x-0 bottom-0 flex flex-col bg-gradient-to-t from-black/60 to-transparent px-2 pt-4 pb-1.5 text-xs text-white transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover/tile:opacity-100 pointer-fine:group-focus-visible/tile:opacity-100">{overlay}</span>
      )}
      {overlay && shown === "glyph" && (
        <span className="absolute inset-x-0 bottom-0 flex flex-col px-2 pb-1.5 text-xs text-muted-foreground transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover/tile:opacity-100 pointer-fine:group-focus-visible/tile:opacity-100">{overlay}</span>
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
  const { id, path: knownPath, name, kind, sealed: knownSealed } = a;
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let release: (() => void) | undefined;
    setFile((f) => (f?.id === id && f.state === "ready" ? f : { id, state: "loading" }));
    (async (): Promise<StoredFile> => {
      let path = knownPath;
      let sealed = !!knownSealed;
      if (!path) {
        const { data } = await supabase.from("attachments").select(await withSealedColumns("storage_path, team_path, sealed")).eq("id", id).maybeSingle();
        path = data?.team_path ?? data?.storage_path ?? undefined;
        sealed = !!data?.sealed;
      }
      if (isNotePath(path) || (path && sealed)) {
        // A note file or a sealed attachment is opened here: it is unsealed in the browser and held until the viewer closes.
        rememberNoteMime(path!, mimeFor({ name, kind }));
        const handle = acquireNoteFile(path!);
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
  }, [id, knownPath, name, kind, knownSealed, open]);
  return file?.id === id ? file : null;
}

const CLOCK = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

/** "14 October 2026, 14:05": the viewer's line under the sender. */
function viewerStamp(iso: string) {
  return `${fullDate(iso)}, ${CLOCK.format(new Date(iso))}`;
}

/** Your own photo, from the account you signed in with, beside files you sent. */
function MeAvatar({ className }: { className?: string }) {
  return <MyAvatar className={className} />;
}

// The tallest a picture is shown, and the widest it can be inside the dialog (its max width less its padding and margins).
const STAGE = "min(65dvh, 100dvh - 14rem)";
const STAGE_WIDTH = "min(46rem, 100vw - 4rem)";

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
function ImageViewer({ url, name, preview, onRatio, onBroken, onSwipe }: { url: string; name: string; /** A small copy to show until the full picture has arrived. */ preview?: string | null; /** The picture's width over its height, once known, so the dialog can hug it. */ onRatio?: (ratio: number) => void; onBroken: () => void; onSwipe?: (direction: -1 | 1) => void }) {
  const [loaded, setLoaded] = useState(false);
  const [ratio, setRatio] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [turns, setTurns] = useState(0); // quarter turns clockwise
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

  // Turned on its side, the picture's frame swaps its shape, and the picture is laid out in the swapped box so it fills it once turned.
  const sideways = turns % 2 === 1;
  const shownRatio = ratio ? (sideways ? 1 / ratio : ratio) : null;
  const motion = { transform: `translate(${offset.x}px, ${offset.y}px) ${sideways ? "translate(-50%, -50%) " : ""}rotate(${turns * 90}deg) scale(${zoom})`, transition: drag.current || pinch.current ? "none" : "transform 80ms" };
  const sidewaysBox = sideways && ratio ? { position: "absolute" as const, top: "50%", left: "50%", width: `${ratio * 100}%`, height: `${100 / ratio}%`, maxWidth: "none" } : null;
  return (
    <div className="flex flex-col gap-3">
      <div
        ref={frame}
        className={cn("relative mx-auto flex max-w-full touch-none items-center justify-center overflow-hidden rounded-lg select-none", !shownRatio && STAGE_HEIGHT, zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in")}
        // Hugs the picture: as wide as fits, up to the stage height's worth, and no wider than the dialog. Only the width is set, so
        // when the dialog is narrower the height follows the picture's shape and no bars appear above and below it.
        style={shownRatio ? { aspectRatio: shownRatio, width: `min(${STAGE_WIDTH}, calc(${STAGE} * ${shownRatio}))` } : { width: "100%" }}
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
        {/* The small copy, already in the browser from the tile, fills the frame until the full picture has loaded over it. */}
        {preview && !loaded && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" draggable={false} onLoad={(e) => { const r = e.currentTarget.naturalWidth / e.currentTarget.naturalHeight; setRatio((x) => x ?? r); onRatio?.(r); }} className="absolute inset-0 size-full object-contain" />
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name}
          draggable={false}
          decoding="async"
          fetchPriority="high"
          onLoad={(e) => { const r = e.currentTarget.naturalWidth / e.currentTarget.naturalHeight; setLoaded(true); setRatio(r); onRatio?.(r); }}
          onError={onBroken}
          className={cn(!sidewaysBox && "size-full", "object-contain", !loaded && preview && "opacity-0")}
          style={{ ...sidewaysBox, ...motion }}
        />
      </div>
      {/* Fit on the left, zoom in the middle and Rotate on the right. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center">
        <Button variant="ghost" size="icon" className="justify-self-start" aria-label="Fit" title="Fit" disabled={zoom === 1} onClick={() => zoomTo(1)}><Maximize /></Button>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Zoom Out" title="Zoom Out" disabled={zoom <= 1} onClick={() => zoomBy(1 / 1.5)}><ZoomOut /></Button>
          <span className="w-11 text-center text-xs text-muted-foreground tabular-nums">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon" aria-label="Zoom In" title="Zoom In" disabled={zoom >= IMAGE_MAX_ZOOM} onClick={() => zoomBy(1.5)}><ZoomIn /></Button>
        </div>
        <Button variant="ghost" size="icon" className="justify-self-end" aria-label="Rotate" title="Rotate" onClick={() => { setTurns((t) => (t + 1) % 4); zoomTo(1); }}><RotateCw /></Button>
      </div>
    </div>
  );
}

/** What the viewer says when there is no stored copy. A big video and a full seat each say why. */
function notKeptMessage(a: Attachment, notStored: boolean): string {
  if (a.notKept === "video_link") return "Not Kept Here. Large Videos Stay at the Original. Open It in Your Mailbox or Chat.";
  if (a.notKept === "over_cap") return "Not Kept Here. Your Storage Is Full. The Original Is in Your Mailbox or Chat.";
  return notStored ? "Not Kept Here. The Original Is in Your Mailbox or Chat." : "Not Downloaded Yet. If It Stays Empty, the Original Is in Your Mailbox or Chat.";
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
  /** Who sent the file and when. Pictures, videos and voice notes are headed with them: the person, then the date and time. */
  sender?: { name: string; contact?: Contact; /** Sent by you, so it shows your own photo. */ me?: boolean };
  sentAt?: string;
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

function ViewerDialog({ attachment: a, open, detail, sender, sentAt, href, onClose, items, index, onNavigate }: Omit<ViewerProps, "attachment"> & { attachment: Attachment; open: boolean }) {
  const file = useStoredFile(a, open);
  const [broken, setBroken] = useState<string | null>(null); // id of an image the browser could not draw
  const [saving, setSaving] = useState(false);
  const [hugging, setHugging] = useState<{ id: string; ratio: number } | null>(null);
  const notStored = a.hiddenReason === "tiny" || a.hiddenReason === "junk" || !!a.notKept;
  const wide = file?.state === "ready" && a.kind === "pdf";
  // The tile's small copy is usually cached already, so a picture has something to show while the full one loads.
  const preview = useSignedUrl(BUCKET, open && a.kind === "image" && !a.sealed && !isNotePath(a.path) && thumbsEnabled() ? a.path : undefined, true);
  // Pictures, videos and voice notes have no name worth showing; PDFs and other files keep theirs.
  const titled = a.kind === "pdf" || a.kind === "file";
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
    try {
      const url = file.sealed ? file.download : (await downloadUrl(BUCKET, file.path, a.name).catch(() => null)) ?? file.download;
      const link = document.createElement("a");
      link.href = url;
      link.download = a.name;
      document.body.append(link);
      link.click();
      link.remove();
    } finally {
      setSaving(false);
    }
  };

  let body: ReactNode;
  if (!file || file.state === "loading") body = <Skeleton className={cn("w-full rounded-lg", STAGE_HEIGHT)} />;
  else if (file.state === "missing")
    body = <NoPreview attachment={a} message={notKeptMessage(a, notStored)} />;
  else if (a.kind === "pdf") body = <PdfViewer key={a.id} url={file.view} name={a.name} />;
  else if (a.kind === "image" && broken !== a.id) body = <ImageViewer key={a.id} url={file.view} name={a.name} preview={preview} onRatio={(ratio) => setHugging({ id: a.id, ratio })} onBroken={() => setBroken(a.id)} onSwipe={canStep ? step : undefined} />;
  else if (a.kind === "video") body = <VideoPlayer key={a.id} src={file.view} name={a.name} />;
  else if (a.kind === "audio") body = <div className="flex justify-center rounded-lg bg-muted/40 p-6"><VoiceNote attachment={{ ...a, path: file.path }} me={false} /></div>;
  else body = <NoPreview attachment={a} message="No Preview Available" />;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent track="attachment_viewer" showCloseButton={false} className={cn("max-h-[calc(100dvh-2rem)] grid-cols-1 gap-3 overflow-y-auto sm:max-w-3xl", wide && "sm:max-w-5xl", a.kind === "image" && hugging?.id === a.id && "w-fit min-w-[min(24rem,calc(100%-2rem))] sm:max-w-3xl")}>
        {/* Who sent it, with their photo, and when. Show in Conversation, Download and Close are on the right. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          {sender && (sender.me ? <MeAvatar className="size-8" /> : <ContactAvatar contact={sender.contact} className="size-8" />)}
          <div className="min-w-32 flex-1 basis-40">
            <DialogTitle className="truncate text-sm font-medium">{sender?.name ?? detail ?? (titled ? a.name : KIND_LABEL[a.kind])}</DialogTitle>
            <DialogDescription className={cn("truncate text-xs", !sentAt && "sr-only")}>{sentAt ? viewerStamp(sentAt) : KIND_LABEL[a.kind]}</DialogDescription>
            <span className="sr-only">{[a.name, KIND_LABEL[a.kind], place >= 0 ? `${place + 1} of ${count}` : ""].filter(Boolean).join(" · ")}</span>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {href && <Button variant="ghost" size="icon" asChild aria-label="Show in Conversation" title="Show in Conversation"><Link href={href}><ExternalLink /></Link></Button>}
            <DialogClose asChild><Button variant="secondary" size="icon" aria-label="Close" title="Close"><X /></Button></DialogClose>
          </div>
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
        {/* The place in the files on the left, with the arrows that step through them; Download on the right. */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {canStep && (
              <>
                <Button variant="secondary" size="icon" aria-label="Previous" title="Previous" disabled={!hasPrev} onClick={() => step(-1)}><ArrowLeft /></Button>
                <Button variant="secondary" size="icon" aria-label="Next" title="Next" disabled={!hasNext} onClick={() => step(1)}><ArrowRight /></Button>
                <span className="text-xs text-muted-foreground tabular-nums">{place + 1} of {count}</span>
              </>
            )}
          </div>
          <Button variant="secondary" disabled={file?.state !== "ready" || saving} onClick={() => void download()}>Download</Button>
        </div>
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
/** "1 File" or "2,500 Files", the count in the browser's locale. */
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
      <div className={cn("grid grid-cols-3 gap-x-3 gap-y-4 md:grid-cols-6", className)}>
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
                <AttachmentTile
                  attachment={a}
                  onOpen={() => setViewing(a)}
                  showName={false}
                  source={sourceOf(threadById(a.threadId)?.provider)}
                  overlay={<><span className="truncate">{who(a.from)}</span><span className="truncate text-[10px] opacity-80">{fullDate(a.sentAt)}</span></>}
                  className="aspect-square size-auto w-full"
                />
              </div>
            </Fragment>
          );
        })}
        {items.length > limit && <MoreSentinel key={limit} onSeen={() => setLimit((n) => n + GRID_PAGE)} />}
      </div>
      <AttachmentViewer
        attachment={viewing}
        detail={viewing ? `${who(viewing.from)}, ${stampOf(viewing.sentAt)}` : undefined}
        sender={viewing ? { name: who(viewing.from), contact: viewing.from === "me" ? undefined : contactById(viewing.from), me: viewing.from === "me" } : undefined}
        sentAt={viewing?.sentAt}
        href={viewing ? hrefFor(viewing) : undefined}
        items={items}
        index={at}
        onNavigate={(i) => { if (items[i]) setViewing(items[i]); }}
        onClose={() => setViewing(null)}
      />
    </>
  );
}
