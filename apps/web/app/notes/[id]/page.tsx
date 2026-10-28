"use client";

// An open note (/notes/[id]) in the right-hand pane.

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { NoteView } from "@/components/note-view";

export default function NotePage() {
  const { id } = useParams<{ id: string }>();
  return (
    <Suspense fallback={null}>
      <NoteView noteId={id} />
    </Suspense>
  );
}
