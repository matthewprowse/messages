"use client";

// Asks before deleting a note and its files. Used by the list's row actions and the open note's More menu.

import { useRef } from "react";
import type { Note } from "@/lib/notes";
import { useNotes } from "@/components/notes-data";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { noteTitle } from "@/components/notes/note-row";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

/** Open while `note` is set; `onDeleted` runs as the delete starts, so the caller can leave the note. */
export function DeleteNoteDialog({ note, onClose, onDeleted }: { note: Note | null; onClose: () => void; onDeleted?: () => void }) {
  const { remove } = useNotes();
  // The note stays named in the dialog while it fades out.
  const last = useRef(note);
  if (note) last.current = note;
  return (
    <AlertDialog open={!!note} onOpenChange={(open) => !open && onClose()}>
      {/* The title says it all, so there is no description to point at. */}
      <AlertDialogContent track="delete_note" aria-describedby={undefined}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {last.current ? noteTitle(last.current) : "Note"}?</AlertDialogTitle>
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
