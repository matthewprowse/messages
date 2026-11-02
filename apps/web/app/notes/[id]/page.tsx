"use client";

// An open note (/notes/[id]) in the right-hand pane.

import { Suspense } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";

// The editor, PDF code and file handling load only when a note is opened, not with the list.
const NoteView = dynamic(() => import("@/components/note-view").then((m) => m.NoteView), { loading: () => null });

export default function NotePage() {
  const { id } = useParams<{ id: string }>();
  return (
    <Suspense fallback={null}>
      <NoteView noteId={id} />
    </Suspense>
  );
}
