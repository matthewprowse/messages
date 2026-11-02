"use client";

// With no note open, the right-hand pane invites picking one or starting a new one.

import { NotebookPen } from "lucide-react";
import { useNewNote, useNotes } from "@/components/notes-data";
import { EmptyState } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

export default function NotesIndex() {
  const { creating, newNote } = useNewNote();
  const { notes, loading } = useNotes();
  // With nothing written yet the pane invites the first note instead of asking to pick one.
  const first = !loading && notes.length === 0;
  return (
    <EmptyState
      icon={NotebookPen}
      title={first ? "Write Your First Note" : "Select a Note"}
      description={first ? "Keep call notes, quotes and checklists next to your conversations." : "Choose a note from the list to read or edit it."}
      action={
        <div className="flex flex-col items-center gap-3">
          <Button variant="secondary" disabled={creating} onClick={() => void newNote()}>{first ? "Write a Note" : "New Note"}</Button>
          <p className="text-xs text-muted-foreground">Press <Kbd>N</Kbd> for a new note or <Kbd>/</Kbd> to search.</p>
        </div>
      }
    />
  );
}
