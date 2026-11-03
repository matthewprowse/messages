"use client";

// What the Notes page shows with no note open, laid out like the empty Conversations page: the title, numbers (notes,
// pinned, used in drafts) and cards of pinned and recent notes. Someone with no notes yet gets the title and New Note.
// Hidden on a phone, where the list is the page.

import { useMemo } from "react";
import type { Note } from "@/lib/notes";
import { noteExcerpt } from "@/lib/note-text";
import { relTime } from "@/lib/format";
import { useNewNote, useNotes } from "@/components/notes-data";
import { useNotesView } from "@/components/notes/list-view";
import { noteIcon, noteTitle } from "@/components/notes/note-row";
import { Card, IconCircle, PaneColumn, Row, Separated, StatCard } from "@/components/surface";
import { Button } from "@/components/ui/button";

/** Rows per card: a glance, with See All for the rest. */
const SHOWN = 3;

function NoteLink({ note }: { note: Note }) {
  const preview = note.unloaded ? note.excerpt ?? "" : noteExcerpt(note.body);
  return <Row href={`/notes/${note.id}`} lead={<IconCircle icon={noteIcon(note)} />} title={noteTitle(note)} meta={relTime(note.updatedAt)} detail={preview || undefined} />;
}

/** Puts the list back on Notes and moves focus to the first row the card stands for, so the rest are a J away. */
function SeeAll({ pinned }: { pinned: boolean }) {
  const { setView } = useNotesView();
  const go = () => {
    setView("notes");
    // The list redraws for the view first, then the row can take focus.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(pinned ? "[data-row-link][data-pinned]" : "[data-row-link]:not([data-pinned])")?.focus());
  };
  return <button type="button" onClick={go} className="shrink-0 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">See All</button>;
}

export function NotesHome() {
  const { notes, loading } = useNotes();
  const { creating, newNote } = useNewNote();
  const live = useMemo(() => notes.filter((n) => !n.archived), [notes]);
  const pinned = useMemo(() => live.filter((n) => n.pinned), [live]);
  const recent = useMemo(() => live.filter((n) => !n.pinned), [live]);
  const drafts = useMemo(() => live.filter((n) => n.useInDrafts).length, [live]);
  // With nothing written yet there is nothing to count: just the way in.
  if (!loading && notes.length === 0) {
    return (
      <PaneColumn center>
        <div className="flex flex-col items-center gap-6">
          <h1 className="text-2xl font-medium">Write Your First Note</h1>
          <Button disabled={creating} onClick={() => void newNote()}>New Note</Button>
        </div>
      </PaneColumn>
    );
  }
  return (
    <PaneColumn center>
      <h1 className="pb-3 text-2xl font-medium">Notes</h1>
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Notes" value={loading ? undefined : live.length} />
        <StatCard label="Pinned" value={loading ? undefined : pinned.length} />
        <StatCard label="Used in Drafts" value={loading ? undefined : drafts} />
      </div>
      {pinned.length > 0 && (
        <Card title="Pinned" action={pinned.length > SHOWN ? <SeeAll pinned /> : undefined}>
          <Separated>{pinned.slice(0, SHOWN).map((n) => <NoteLink key={n.id} note={n} />)}</Separated>
        </Card>
      )}
      {recent.length > 0 && (
        <Card title="Recent" action={recent.length > SHOWN ? <SeeAll pinned={false} /> : undefined}>
          <Separated>{recent.slice(0, SHOWN).map((n) => <NoteLink key={n.id} note={n} />)}</Separated>
        </Card>
      )}
    </PaneColumn>
  );
}
