"use client";

// The full-screen viewer for any attachment. PDFs open in the built-in viewer, images zoom and pan, videos play, and
// other files can be downloaded. Steps through the files it came from with buttons, arrow keys and swipes.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { track } from "@/lib/analytics";
import { FETCH_TEXT } from "@/lib/attachment-fetch";
import { ATTACHMENT_BUCKET as BUCKET, KIND_LABEL, notKeptMessage, swipeOf } from "@/lib/attachment-view";
import { downloadUrl, isNotePath, thumbsEnabled, useSignedUrl } from "@/lib/signed-urls";
import type { Attachment, Contact } from "@/lib/types";
import { fullDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { ContactAvatar } from "@/components/primitives";
import { MyAvatar } from "@/components/my-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { PdfViewer } from "@/components/pdf-viewer";
import { STAGE_HEIGHT, VideoPlayer, VoiceNote } from "@/components/media-player";
import { AlsoIn } from "./also-in";
import { DocumentCardPanel } from "./document-card";
import { useDocumentCards } from "./document-store";
import { FileGlyph } from "./file-glyph";
import { ImageViewer } from "./image-viewer";
import { useRequestedFile } from "./use-requested-file";
import { useStoredFile } from "./use-stored-file";

const CLOCK = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

/** "14 October 2026, 14:05": the viewer's line under the sender. */
function viewerStamp(iso: string) {
  return `${fullDate(iso)}, ${CLOCK.format(new Date(iso))}`;
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
  /** Given by a list that can hide files (the Attachments page): adds Hide, or Unhide for a hidden file, to the footer. */
  onToggleHidden?: () => Promise<void>;
  /** Given by a list that can delete files (the Attachments page): adds Delete to the footer and "Also in N Conversations" under the name. */
  onDelete?: () => Promise<void>;
  /** The conversation the open file is in, so "Also in N Conversations" leaves it out. */
  threadId?: string;
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

function ViewerDialog({ attachment: a, open, detail, sender, sentAt, href, onClose, items, index, onNavigate, onToggleHidden, onDelete, threadId }: Omit<ViewerProps, "attachment"> & { attachment: Attachment; open: boolean }) {
  const [toggling, setToggling] = useState(false);
  const cardOf = useDocumentCards(open ? [a.id] : []);
  const [deleting, setDeleting] = useState(false);
  const requested = useRequestedFile(a, open);
  // Once the worker has stored a requested file the viewer opens it like any other.
  const file = useStoredFile(requested.path ? { ...a, path: requested.path, sealed: requested.sealed } : a, open && (requested.status === "none" || requested.status === "ready"));
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
  if (requested.status === "fetching")
    body = (
      <div role="status" className="flex flex-col items-center gap-3">
        <Skeleton className={cn("w-full rounded-lg", STAGE_HEIGHT)} />
        <span className="text-sm text-muted-foreground">{FETCH_TEXT.fetching}</span>
      </div>
    );
  else if (requested.status === "error" && requested.error)
    body = (
      <div className="flex flex-col items-center gap-3">
        <NoPreview attachment={a} message={requested.error.message} />
        {requested.error.retry && <Button variant="secondary" className="h-8" onClick={requested.retry}>Retry</Button>}
      </div>
    );
  else if (!file || file.state === "loading") body = <Skeleton className={cn("w-full rounded-lg", STAGE_HEIGHT)} />;
  else if (file.state === "missing")
    body = <NoPreview attachment={a} message={notKeptMessage(a, notStored)} />;
  else if (file.state === "too_large")
    body = <NoPreview attachment={a} message="Too large to open on this device. Open it on a computer." />;
  else if (a.kind === "pdf") body = <PdfViewer key={a.id} url={file.view} name={a.name} />;
  else if (a.kind === "image" && broken !== a.id) body = <ImageViewer key={a.id} url={file.view} name={a.name} preview={preview} onRatio={(ratio) => setHugging({ id: a.id, ratio })} onBroken={() => setBroken(a.id)} onSwipe={canStep ? step : undefined} />;
  else if (a.kind === "video") body = <VideoPlayer key={a.id} src={file.view} name={a.name} />;
  else if (a.kind === "audio") body = <div className="flex justify-center rounded-lg bg-muted/40 p-6"><VoiceNote attachment={{ ...a, path: file.path }} me={false} /></div>;
  else body = <NoPreview attachment={a} message="No Preview Available" />;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent track="attachment_viewer" showCloseButton={false} className={cn("max-h-[calc(100dvh-2rem)] grid-cols-1 gap-3 overflow-y-auto sm:max-w-3xl", wide && "sm:max-w-5xl", a.kind === "image" && hugging?.id === a.id && "w-fit min-w-[min(24rem,calc(100%-2rem))] sm:max-w-3xl")}>
        {/* Who sent it, with their photo, and when. Show in Conversation is on the right; Download and Close are in the footer. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          {sender && (sender.me ? <MyAvatar className="size-8" /> : <ContactAvatar contact={sender.contact} className="size-8" />)}
          <div className="min-w-32 flex-1 basis-40">
            <DialogTitle className="truncate text-sm font-medium">{sender?.name ?? detail ?? (titled ? a.name : KIND_LABEL[a.kind])}</DialogTitle>
            <DialogDescription className={cn("truncate text-xs", !sentAt && "sr-only")}>{sentAt ? viewerStamp(sentAt) : KIND_LABEL[a.kind]}</DialogDescription>
            {/* What you are about to download: the file's own name and size, always on show. */}
            <span className="block truncate text-xs text-muted-foreground">{[a.name, a.size].filter(Boolean).join(", ")}</span>
            {onDelete && <AlsoIn attachmentId={a.id} threadId={threadId} open={open} />}
            <span className="sr-only">{[KIND_LABEL[a.kind], place >= 0 ? `${place + 1} of ${count}` : ""].filter(Boolean).join(" · ")}</span>
          </div>
          {href && (
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Button variant="ghost" size="icon" asChild aria-label="Show in Conversation" title="Show in Conversation"><Link href={href}><ExternalLink /></Link></Button>
            </div>
          )}
        </div>
        <DocumentCardPanel attachment={a} entry={cardOf(a.id)} />
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
        {/* The place in the files on the left, with the arrows that step through them; Download and Close on the right. Escape closes too. */}
        <DialogFooter className="flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {canStep && (
              <>
                <Button variant="secondary" size="icon" aria-label="Previous" title="Previous" disabled={!hasPrev} onClick={() => step(-1)}><ArrowLeft /></Button>
                <Button variant="secondary" size="icon" aria-label="Next" title="Next" disabled={!hasNext} onClick={() => step(1)}><ArrowRight /></Button>
                <span className="text-xs text-muted-foreground tabular-nums">{place + 1} of {count}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onToggleHidden && (
              <Button variant="secondary" disabled={toggling} onClick={() => { setToggling(true); void onToggleHidden().finally(() => setToggling(false)); }}>{a.hiddenReason ? "Unhide" : "Hide"}</Button>
            )}
            {onDelete && a.path && (
              <Button variant="secondary" disabled={deleting} onClick={() => { setDeleting(true); void onDelete().finally(() => setDeleting(false)); }}>Delete</Button>
            )}
            <Button variant="secondary" disabled={file?.state !== "ready" || saving} onClick={() => void download()}>Download</Button>
            <DialogClose asChild><Button variant="secondary">Close</Button></DialogClose>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
