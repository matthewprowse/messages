"use client";

// With no note open, the right-hand pane invites picking one or starting a new one.

import { NotebookPen } from "lucide-react";
import { useNewNote } from "@/components/notes-data";
import { EmptyState } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

export default function NotesIndex() {
  const { creating, newNote } = useNewNote();
  return (
    <EmptyState
      icon={NotebookPen}
      title="Select a Note"
      description="Choose a note from the list to read or edit it."
      action={
        <div className="flex flex-col items-center gap-3">
          <Button variant="secondary" disabled={creating} onClick={() => void newNote()}>New Note</Button>
          <p className="text-xs text-muted-foreground">Press <Kbd>N</Kbd> for a new note or <Kbd>/</Kbd> to search.</p>
        </div>
      }
    />
  );
}
