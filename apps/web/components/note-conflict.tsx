"use client";

// Shown above an open note when its saved version changed in another tab or on another device while this one had
// unsaved changes. Nothing is written until the user picks, so neither version is lost by accident.

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useNotes } from "@/components/notes-data";

export function NoteConflictBar({ id }: { id: string }) {
  const { conflictOf, resolveConflict } = useNotes();
  const [busy, setBusy] = useState(false);
  const other = conflictOf(id);
  const pick = async (how: "both" | "mine" | "theirs") => {
    setBusy(true);
    try { await resolveConflict(id, how); } finally { setBusy(false); }
  };
  return (
    <div className="shrink-0 px-3 pb-3 md:px-4">
      <Alert className="mx-auto max-w-2xl">
        <TriangleAlert />
        <AlertTitle>{other === null ? "This Note Was Deleted Elsewhere" : "This Note Changed Elsewhere"}</AlertTitle>
        <AlertDescription>
          {other === null
            ? "Your latest changes are not saved yet. Save the note again to keep what you wrote."
            : "It was edited in another tab or on another device. Your changes are not saved yet, and nothing is overwritten until you choose."}
          <div className="mt-2 flex flex-wrap gap-2">
            {other !== null && <Button size="sm" disabled={busy} onClick={() => void pick("both")}>Keep Both</Button>}
            {other !== null && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void pick("theirs")}>Use Other Version</Button>}
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void pick("mine")}>{other === null ? "Save Again" : "Keep Mine Only"}</Button>
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
}
