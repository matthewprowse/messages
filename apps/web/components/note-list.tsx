"use client";

// The Notes list: the header (New Note, templates, the Notes, Used in Drafts and Archived views and the search), then
// the notes, pinned first then newest edits, with row actions on hover or a swipe to the left, and the delete dialog.
// The row is components/notes/note-row.tsx; the keys are components/notes/use-list-keys.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Archive, LayoutTemplate, NotebookPen, Plus } from "lucide-react";
import type { Note } from "@/lib/notes";
import { matchesNote } from "@/lib/note-text";
import { factStatus } from "@/lib/note-facts";
import { useDraftFacts } from "@/components/note-drafts-badge";
import { useNewNote, useNotes } from "@/components/notes-data";
import { useToday } from "@/components/thread-list";
import { PaneHeader, ViewButtons } from "@/components/pane";
import { Separated } from "@/components/surface";
import { IconAction, Tip } from "@/components/tip";
import { EmptyState } from "@/components/primitives";
import { DeleteNoteDialog } from "@/components/notes/delete-note-dialog";
import { inView, useNotesView, type NotesView } from "@/components/notes/list-view";
import { NoteLoadingRows, NoteRow } from "@/components/notes/note-row";
import { useListShortcuts, useRowNavigation } from "@/components/notes/use-list-keys";
import { useSwipeOpen } from "@/components/use-row-swipe";
import { fromTemplate, NOTE_TEMPLATES, shortDate } from "@/lib/note-templates";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function NoteList() {
  const { notes: all, loading, error, reload, opening, ensureAllBodies, pin, archive, draftWith, warm } = useNotes();
  const { view, setView } = useNotesView();
  const notes = useMemo(() => all.filter((n) => inView(n, view)), [all, view]);
  const archivedCount = useMemo(() => all.filter((n) => n.archived).length, [all]);
  const draftsCount = useMemo(() => all.filter((n) => inView(n, "drafts")).length, [all]);
  const facts = useDraftFacts(all);
  const params = useParams<{ id?: string }>();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<Note | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const term = search.trim();
  // Searching starts with titles and excerpts; the rest of the text is downloaded in the background.
  useEffect(() => { if (term) ensureAllBodies(); }, [term, ensureAllBodies]);
  // Already sorted pinned first, then the most recently edited (sortNotes).
  const shown = useMemo(() => (term ? notes.filter((n) => matchesNote(n, term)) : notes), [notes, term]);
  const rowsRef = useRowNavigation<HTMLDivElement>();
  const { openId, onSwipe, onTouchRow } = useSwipeOpen();
  const today = useToday();
  const onPin = useCallback((note: Note) => pin(note.id, !note.pinned), [pin]);
  const onArchive = useCallback((note: Note) => archive(note.id, !note.archived), [archive]);
  const onDraft = useCallback((note: Note) => draftWith(note.id, !note.useInDrafts), [draftWith]);
  const clearSearch = useCallback(() => setSearch(""), []);
  const { creating, newNote } = useNewNote(clearSearch);
  useListShortcuts(searchRef, () => void newNote());
  // Results are not final while some text is still being opened, so an empty search waits in loading rows.
  const searching = !!term && opening;

  const views: { key: NotesView; label: string; count?: number }[] = [
    { key: "notes", label: "Notes" },
    { key: "drafts", label: "Used in Drafts", count: draftsCount },
    { key: "archived", label: "Archived", count: archivedCount },
  ];

  return (
    // The header sits above the scroll area, so the rows and their scrollbar both start below it.
    <div className="flex h-full min-h-0 flex-col">
      <PaneHeader
        className="shrink-0"
        title="Notes"
        action={
          <>
            <IconAction label="New Note" icon={Plus} disabled={creating} aria-keyshortcuts="N" onClick={() => void newNote()} />
            <DropdownMenu>
              <Tip label="Templates">
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" disabled={creating} aria-label="Templates"><LayoutTemplate /></Button>
                </DropdownMenuTrigger>
              </Tip>
              <DropdownMenuContent align="end" className="w-max">
                <DropdownMenuLabel>New From a Template</DropdownMenuLabel>
                {NOTE_TEMPLATES.map((t) => <DropdownMenuItem key={t.id} onClick={() => void newNote(fromTemplate(t, shortDate(new Date())))}>{t.name}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
        views={<ViewButtons label="Notes Views" items={views} value={view} onSelect={setView} />}
        search={{ value: search, onChange: setSearch, placeholder: "Search Notes", inputRef: searchRef, keyShortcut: "/" }}
      />
      <ScrollArea className="min-h-0 flex-1">
        <div ref={rowsRef} className="p-3">
          {loading && notes.length === 0 && <NoteLoadingRows />}
          {!loading && shown.length === 0 && (searching ? <NoteLoadingRows /> : (
            <div className="py-24">
              {error && notes.length === 0 ? (
                <EmptyState icon={NotebookPen} title="Could Not Load Notes" action={<Button variant="link" onClick={reload}>Try Again</Button>} />
              ) : term ? (
                <EmptyState icon={NotebookPen} title="No Matches" />
              ) : view === "archived" ? (
                <EmptyState icon={Archive} title="Nothing Archived" />
              ) : view === "drafts" ? (
                <EmptyState icon={NotebookPen} title="No Notes Used in Drafts" />
              ) : (
                <EmptyState icon={NotebookPen} title="No Notes Yet" />
              )}
            </div>
          ))}
          <Separated>
            {shown.map((n) => (
              <NoteRow key={n.id} note={n} drafts={factStatus(facts, n)} term={term} today={today} selected={params.id === n.id} open={openId === n.id} onSwipe={onSwipe} onTouchRow={onTouchRow} onPin={onPin} onDelete={setDeleting} onDraft={onDraft} onArchive={onArchive} onWarm={warm} />
            ))}
          </Separated>
        </div>
      </ScrollArea>
      <DeleteNoteDialog note={deleting} onClose={() => setDeleting(null)} onDeleted={() => { if (deleting && params.id === deleting.id) router.push("/notes"); }} />
    </div>
  );
}
