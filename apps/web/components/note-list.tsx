"use client";

// The Notes list: search, pinned notes first then newest edits, and the delete dialog.

import { PaneHeader, SearchBand } from "@/components/pane";
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ListChecks, NotebookPen, Pin, PinOff, Trash2, type LucideIcon } from "lucide-react";
import type { Note } from "@/lib/notes";
import { checklistProgress, matchesNote, matchingLine, noteExcerpt, searchWords } from "@/lib/note-text";
import { factStatus } from "@/lib/note-facts";
import { DraftsBadge, DraftsSummary, useDraftFacts, type DraftsStatus } from "@/components/note-drafts-badge";
import { relTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useNewNote, useNotes } from "@/components/notes-data";
import { useToday } from "@/components/thread-list";
import { EmptyState } from "@/components/primitives";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

// Laid out like the Conversations list: the title, then the search where the views are and New Note
// where the filter is, then the notes, pinned first and then the most recently edited.

/** A note's title, or Untitled Note while it is blank (the open note's header says the same). */
export const noteTitle = (n: Pick<Note, "title">) => n.title.trim() || "Untitled Note";

/** How long the pointer rests on a row (ms) before its note is fetched ahead of a click. */
const WARM_HOVER_MS = 150;

// The row's text fades out under its two hover buttons, as on conversation rows.
const FADE = "group-hover/row:[mask-image:linear-gradient(to_right,black_calc(100%-112px),transparent_calc(100%-80px))] [&_[data-hover-hide]]:group-hover/row:invisible group-focus-within/row:[mask-image:linear-gradient(to_right,black_calc(100%-112px),transparent_calc(100%-80px))] pointer-coarse:[mask-image:linear-gradient(to_right,black_calc(100%-112px),transparent_calc(100%-80px))] [&_[data-hover-hide]]:group-focus-within/row:invisible [&_[data-hover-hide]]:pointer-coarse:invisible";

function RowButton({ label, icon: Icon, onClick }: { label: string; icon: LucideIcon; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="secondary" size="icon" aria-label={label} onClick={onClick}><Icon /></Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

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

const NoteRow = memo(function NoteRow({ note, drafts, term, today, selected, onPin, onDelete, onDraft, onWarm }: {
  note: Note;
  /** How the note stands for drafts, passed as plain text so the row only redraws when it changes. */
  drafts: DraftsStatus;
  /** The search, when there is one: the row shows the line that matched. */
  term: string;
  /** Only read through relTime: a new day redraws the row. */
  today: string;
  selected: boolean;
  onPin: (note: Note) => void;
  onDelete: (note: Note) => void;
  onDraft: (note: Note) => void;
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
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className={cn("group/row relative rounded-lg", selected ? "bg-muted" : "hover:bg-muted/50")}>
          <Link
            href={`/notes/${note.id}`}
            data-row-link
            onPointerEnter={() => { clearTimeout(hover.current); hover.current = setTimeout(() => onWarm(note.id), WARM_HOVER_MS); }}
            onPointerLeave={() => clearTimeout(hover.current)}
            onFocus={() => onWarm(note.id)}
            aria-current={selected ? "page" : undefined}
            className={cn("flex flex-col gap-1 rounded-lg p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset", FADE)}
          >
            {/* 20px title line + 4px gap + 16px preview line, as on conversation rows. */}
            <div className="flex h-5 items-center justify-between gap-3">
              <span className={cn("flex min-w-0 items-center gap-1.5 text-sm font-medium", !note.title.trim() && "text-muted-foreground")}>
                {note.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" aria-label="Pinned" />}
                <span className="truncate"><Highlight text={noteTitle(note)} words={note.title.trim() ? words : []} /></span>
              </span>
              <span data-hover-hide className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted-foreground">
                {progress && <span className="flex items-center gap-1" aria-label={`${progress.done} of ${progress.total} done`}><ListChecks className="size-3" />{progress.done}/{progress.total}</span>}
                {relTime(note.updatedAt)}
              </span>
            </div>
            <div className="flex h-4 items-center gap-2">
              <span className={cn("min-w-0 flex-1 truncate text-xs", !preview && "text-muted-foreground")}>{preview ? <Highlight text={preview} words={words} /> : note.unloaded && note.excerpt === null ? "" : "No Text"}</span>
              <DraftsBadge status={drafts} />
            </div>
          </Link>
          <div className="absolute top-1/2 right-3 hidden -translate-y-1/2 items-center gap-1 group-hover/row:flex group-focus-within/row:flex pointer-coarse:flex">
            <RowButton label={note.pinned ? "Unpin" : "Pin"} icon={note.pinned ? PinOff : Pin} onClick={() => onPin(note)} />
            <RowButton label="Delete" icon={Trash2} onClick={() => onDelete(note)} />
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-max">
        <ContextMenuItem onSelect={() => onPin(note)}>{note.pinned ? "Unpin" : "Pin"}</ContextMenuItem>
        <ContextMenuCheckboxItem checked={note.useInDrafts} onCheckedChange={() => onDraft(note)}>Use in Drafts</ContextMenuCheckboxItem>
        <ContextMenuItem variant="destructive" onSelect={() => onDelete(note)}>Delete</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

function LoadingRows() {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Loading Notes">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex flex-col gap-1 p-3">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      ))}
    </div>
  );
}

/** Asks before deleting a note and its files. */
export function DeleteNoteDialog({ note, onClose, onDeleted }: { note: Note | null; onClose: () => void; onDeleted?: () => void }) {
  const { remove } = useNotes();
  // The note stays named in the dialog while it fades out.
  const last = useRef(note);
  if (note) last.current = note;
  return (
    <AlertDialog open={!!note} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent track="delete_note">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {last.current ? noteTitle(last.current) : "Note"}?</AlertDialogTitle>
          <AlertDialogDescription>The note and the files in it are deleted. This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className={DIALOG_BUTTONS}>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (!note) return;
              onDeleted?.();
              void remove(note.id);
            }}
          >
            Delete Note
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const TYPING = "input, textarea, select, [contenteditable=true], [role=menu], [role=dialog], [role=alertdialog]";

/** "/" focuses the search and N starts a note, unless the keys are going into a field. */
function useListShortcuts(search: React.RefObject<HTMLInputElement | null>, onNew: () => void) {
  const latest = useRef(onNew);
  latest.current = onNew;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if ((e.target as HTMLElement | null)?.closest(TYPING)) return;
      if (e.key === "/") {
        e.preventDefault();
        search.current?.focus();
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        latest.current();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [search]);
}

/** J and K move keyboard focus down and up the rows, starting from the focused or open one. */
function useRowNavigation<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.key !== "j" && e.key !== "k")) return;
      if ((e.target as HTMLElement | null)?.closest(TYPING)) return;
      const rows = [...(ref.current?.querySelectorAll<HTMLElement>("[data-row-link]") ?? [])];
      if (rows.length === 0) return;
      const from = rows.findIndex((r) => r === document.activeElement);
      const at = from !== -1 ? from : rows.findIndex((r) => r.getAttribute("aria-current") === "page");
      const next = at === -1 ? 0 : Math.min(rows.length - 1, Math.max(0, at + (e.key === "j" ? 1 : -1)));
      e.preventDefault();
      rows[next].focus({ preventScroll: true });
      rows[next].scrollIntoView({ block: "nearest" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return ref;
}

export function NoteList() {
  const { notes, loading, error, reload, opening, ensureAllBodies, pin, draftWith, warm } = useNotes();
  const facts = useDraftFacts(notes);
  const params = useParams<{ id?: string }>();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<Note | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const term = search.trim();
  // Searching starts with titles and excerpts; the rest of the text is downloaded in the background.
  useEffect(() => { if (term) ensureAllBodies(); }, [term, ensureAllBodies]);
  const shown = useMemo(() => (term ? notes.filter((n) => matchesNote(n, term)) : notes), [notes, term]);
  const pinned = useMemo(() => shown.filter((n) => n.pinned), [shown]);
  const rest = useMemo(() => shown.filter((n) => !n.pinned), [shown]);
  const rowsRef = useRowNavigation<HTMLDivElement>();
  const today = useToday();
  const onPin = useCallback((note: Note) => pin(note.id, !note.pinned), [pin]);
  const onDraft = useCallback((note: Note) => draftWith(note.id, !note.useInDrafts), [draftWith]);
  const clearSearch = useCallback(() => setSearch(""), []);
  const { creating, newNote } = useNewNote(clearSearch);
  useListShortcuts(searchRef, () => void newNote());
  // Results are not final while some text is still being opened.
  const searching = !!term && opening;

  const section = (title: string | null, list: Note[]) => list.length > 0 && (
    <section className="flex flex-col gap-2">
      {title && <h2 className="px-3 pt-1 text-xs font-medium text-muted-foreground">{title}</h2>}
      {list.map((n, i) => (
        <Fragment key={n.id}>
          {i > 0 && <div className="px-3"><Separator /></div>}
          <NoteRow note={n} drafts={factStatus(facts, n)} term={term} today={today} selected={params.id === n.id} onPin={onPin} onDelete={setDeleting} onDraft={onDraft} onWarm={warm} />
        </Fragment>
      ))}
    </section>
  );

  return (
    // The header sits above the scroll area, so the rows and their scrollbar both start below it.
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">
        <PaneHeader
          title="Notes"
          action={
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="secondary" className="shrink-0" disabled={creating} aria-keyshortcuts="N" onClick={() => void newNote()}>New Note</Button>
              </TooltipTrigger>
              <TooltipContent>New Note <Kbd>N</Kbd></TooltipContent>
            </Tooltip>
          }
        />
        <SearchBand inputRef={searchRef} value={search} onChange={setSearch} placeholder="Search Notes" keyShortcut="/" hint={<>Search Notes <Kbd>/</Kbd></>} />
        <DraftsSummary report={facts} />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div ref={rowsRef} className="p-3">
          {loading && notes.length === 0 && <LoadingRows />}
          {!loading && shown.length === 0 && (searching ? <LoadingRows /> : (
            <div className="py-24">
              {error && notes.length === 0 ? (
                <EmptyState icon={NotebookPen} title="Could Not Load Notes" description="Check your connection and try again." action={<Button variant="link" size="sm" onClick={reload}>Try Again</Button>} />
              ) : term ? (
                <EmptyState icon={NotebookPen} title="No Matches" description="No notes match your search." />
              ) : (
                <EmptyState icon={NotebookPen} title="No Notes Yet" description="Notes you write appear here." />
              )}
            </div>
          ))}
          <div className="flex flex-col gap-4">
            {pinned.length > 0 ? (
              <>
                {section("Pinned", pinned)}
                {section("Notes", rest)}
              </>
            ) : section(null, rest)}
          </div>
          {searching && shown.length > 0 && <p className="px-3 pt-3 text-xs text-muted-foreground" role="status">Still searching the text of your notes.</p>}
        </div>
      </ScrollArea>
      <DeleteNoteDialog note={deleting} onClose={() => setDeleting(null)} onDeleted={() => { if (deleting && params.id === deleting.id) router.push("/notes"); }} />
    </div>
  );
}
