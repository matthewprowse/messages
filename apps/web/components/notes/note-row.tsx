"use client";

// One note in the Notes list, laid out like a conversation row: a 40px icon circle, the title and a preview line, the
// time and checklist progress on the right, the actions on hover or a swipe to the left, and the right-click menu.

import { memo, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, ListChecks, NotebookPen, Pin, PinOff, Trash2 } from "lucide-react";
import type { Note } from "@/lib/notes";
import { checklistProgress, matchingLine, noteExcerpt, searchWords } from "@/lib/note-text";
import { relTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DraftsBadge, type DraftsStatus } from "@/components/note-drafts-badge";
import { IconCircle } from "@/components/surface";
import { ROW_FADE, SWIPED_FADE } from "@/components/thread-list/fade";
import { RowButton } from "@/components/thread-list/row-button";
import { useRowSwipe } from "@/components/use-row-swipe";
import { Skeleton } from "@/components/ui/skeleton";
import { ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";

/** A note's title, or Untitled Note while it is blank (the open note's header says the same). */
export const noteTitle = (n: Pick<Note, "title">) => n.title.trim() || "Untitled Note";

/** The icon a note's circle shows: a checklist when the note has one. Undownloaded notes show the plain note. */
export const noteIcon = (n: Pick<Note, "body" | "unloaded">) => (!n.unloaded && checklistProgress(n.body) ? ListChecks : NotebookPen);

/** How long the pointer rests on a row (ms) before its note is fetched ahead of a click. */
const WARM_HOVER_MS = 150;

/** The text with each search word marked. */
function Highlight({ text, words }: { text: string; words: string[] }) {
  const pattern = useMemo(() => (words.length === 0 ? null : new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi")), [words]);
  if (!pattern) return <>{text}</>;
  return (
    <>
      {text.split(pattern).map((part, i) => (i % 2 === 1 ? <mark key={i} className="rounded-sm bg-primary/15 text-foreground">{part}</mark> : part))}
    </>
  );
}

export const NoteRow = memo(function NoteRow({ note, drafts, term, today, selected, open, onSwipe, onTouchRow, onPin, onDelete, onDraft, onArchive, onWarm }: {
  note: Note;
  /** How the note stands for drafts, passed as plain text so the row only redraws when it changes. */
  drafts: DraftsStatus;
  /** The search, when there is one: the row shows the line that matched. */
  term: string;
  /** Only read through relTime: a new day redraws the row. */
  today: string;
  selected: boolean;
  /** Swiped open on a touch screen: the actions are out. */
  open: boolean;
  onSwipe: (id: string | null) => void;
  onTouchRow: (id: string) => void;
  onPin: (note: Note) => void;
  onDelete: (note: Note) => void;
  onDraft: (note: Note) => void;
  onArchive: (note: Note) => void;
  /** Called when the row is pointed at (after a short pause) or focused, to have the note ready. */
  onWarm: (id: string) => void;
}) {
  // Sweeping the pointer across the list must not start a download per row.
  const hover = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(hover.current), []);
  const progress = useMemo(() => (note.unloaded ? null : checklistProgress(note.body)), [note.unloaded, note.body]);
  const words = useMemo(() => searchWords(term), [term]);
  // Until the text is downloaded the stored excerpt stands in for it.
  const text = note.unloaded ? note.excerpt ?? "" : note.body;
  const preview = (term && matchingLine(text, term)) || (note.unloaded ? text : noteExcerpt(text));
  const { handlers, guardClick } = useRowSwipe({ id: note.id, open, onSwipe, onTouchRow });
  // An action closes the swiped row, so the next tap on it opens the note.
  const then = (fn: (note: Note) => void) => () => { if (open) onSwipe(null); fn(note); };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div {...handlers} className={cn("group/row relative touch-pan-y rounded-lg", selected ? "bg-muted" : "hover:bg-muted/50")}>
          <Link
            href={`/notes/${note.id}`}
            data-row-link
            data-pinned={note.pinned || undefined}
            onPointerEnter={() => { clearTimeout(hover.current); hover.current = setTimeout(() => onWarm(note.id), WARM_HOVER_MS); }}
            onPointerLeave={() => clearTimeout(hover.current)}
            onFocus={() => onWarm(note.id)}
            onClick={guardClick}
            aria-current={selected ? "page" : undefined}
            className={cn("flex items-center gap-3 rounded-lg p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset", open ? SWIPED_FADE : ROW_FADE)}
          >
            <IconCircle icon={progress ? ListChecks : NotebookPen} />
            {/* 20px title line + 4px gap + 16px preview line, as on conversation rows. */}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex h-5 items-center justify-between gap-3">
                <span className={cn("flex min-w-0 items-center gap-1.5 text-sm font-medium", !note.title.trim() && "text-muted-foreground")}>
                  {note.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" aria-label="Pinned" />}
                  <span className="truncate"><Highlight text={noteTitle(note)} words={note.title.trim() ? words : []} /></span>
                </span>
                <span data-hover-hide className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted-foreground">
                  {progress && <span aria-label={`${progress.done} of ${progress.total} done`}>{progress.done}/{progress.total}</span>}
                  {relTime(note.updatedAt)}
                </span>
              </div>
              <div className="flex h-4 items-center gap-2">
                <span className={cn("min-w-0 flex-1 truncate text-xs", !preview && "text-muted-foreground")}>{preview ? <Highlight text={preview} words={words} /> : note.unloaded && note.excerpt === null ? "" : "No Text"}</span>
                <DraftsBadge status={drafts} />
              </div>
            </div>
          </Link>
          <div className={cn("absolute top-1/2 right-3 -translate-y-1/2 items-center gap-1", open ? "flex animate-in fade-in-0 slide-in-from-right-4 duration-150" : "hidden group-hover/row:flex pointer-fine:group-focus-within/row:flex")}>
            <RowButton variant="secondary" label={note.pinned ? "Unpin" : "Pin"} icon={note.pinned ? PinOff : Pin} onClick={then(onPin)} />
            <RowButton variant="secondary" label={note.archived ? "Restore" : "Archive"} icon={note.archived ? ArchiveRestore : Archive} onClick={then(onArchive)} />
            <RowButton variant="secondary" label="Delete" icon={Trash2} onClick={then(onDelete)} />
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-max">
        <ContextMenuItem onSelect={() => onPin(note)}>{note.pinned ? "Unpin" : "Pin"}</ContextMenuItem>
        <ContextMenuItem onSelect={() => onArchive(note)}>{note.archived ? "Restore From Archive" : "Archive"}</ContextMenuItem>
        <ContextMenuCheckboxItem checked={note.useInDrafts} onCheckedChange={() => onDraft(note)}>Use in Drafts</ContextMenuCheckboxItem>
        <ContextMenuItem variant="destructive" onSelect={() => onDelete(note)}>Delete</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

/** Placeholder rows, circle and two lines, while the list loads. */
export function NoteLoadingRows() {
  return (
    <div className="flex flex-col gap-2" role="status" aria-busy="true" aria-label="Loading Notes">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 p-3">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-1">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </div>
      ))}
    </div>
  );
}
