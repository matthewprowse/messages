"use client";

// One file as a square tile: its picture or icon, a badge when it is hidden or has no copy, and an optional hover
// caption. Used by the grid, conversations and notes.

import { useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { HIDDEN_HINT, HIDDEN_LABEL } from "@/lib/attachment-view";
import type { Attachment } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Thumb } from "./thumb";

export function AttachmentTile({ attachment: a, onOpen, className, showName = true, overlay, selecting = false, selected = false }: { attachment: Attachment; onOpen: () => void; className?: string; showName?: boolean; overlay?: ReactNode; /** Selecting several files (the Attachments page): the tile shows a tick circle and a click picks it instead of opening it. */ selecting?: boolean; selected?: boolean }) {
  // What the tile shows once it has loaded: a picture, or the file type's icon. The caption waits for either, so it never
  // sits alone over an empty box.
  const [shown, setShown] = useState<"picture" | "glyph" | null>(null);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={selecting ? `Select ${a.name}` : `Open ${a.name}`}
      aria-pressed={selecting ? selected : undefined}
      title={a.name}
      className={cn("group/tile relative flex size-24 overflow-hidden rounded-lg bg-muted text-left outline-none ring-1 ring-foreground/5 focus-visible:ring-2 focus-visible:ring-ring/50", selected && "ring-2 ring-primary", className)}
    >
      {/* Only the picture dims for a hidden file; its badge stays readable. */}
      <span className={cn("flex size-full", a.hiddenReason && "opacity-60")}><Thumb attachment={a} onReady={setShown} /></span>
      {a.hiddenReason ? (
        <Badge variant="secondary" title={HIDDEN_HINT[a.hiddenReason]} className="absolute top-1.5 left-1.5">{HIDDEN_LABEL[a.hiddenReason]}</Badge>
      ) : a.notKept && !a.path ? (
        <Badge variant="secondary" className="absolute top-1.5 left-1.5">{a.notKept === "deferred" ? "Not Downloaded" : a.notKept === "unavailable" ? "Unavailable" : a.notKept === "deleted" ? "Deleted" : "Not Kept Here"}</Badge>
      ) : null}
      {selecting && (
        <span aria-hidden className={cn("absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full border bg-background/90", selected && "border-primary bg-primary text-primary-foreground")}>
          {selected && <Check className="size-3.5" />}
        </span>
      )}
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
