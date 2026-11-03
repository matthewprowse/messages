"use client";

// Which view the Notes list shows (Notes, Used in Drafts, Archived), held above the list and the right-hand pane so the
// empty pane's See All can put the list back on Notes, and the view survives opening one note after another.

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Note } from "@/lib/notes";

export type NotesView = "notes" | "drafts" | "archived";

/** Whether a note belongs in a view. Used in Drafts leaves archived notes out, as drafts do. */
export function inView(note: Pick<Note, "archived" | "useInDrafts">, view: NotesView): boolean {
  if (view === "archived") return !!note.archived;
  return !note.archived && (view === "notes" || note.useInDrafts);
}

const ViewContext = createContext<{ view: NotesView; setView: (view: NotesView) => void } | null>(null);

export function NotesViewProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<NotesView>("notes");
  const value = useMemo(() => ({ view, setView }), [view]);
  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
}

/** The list's view and its setter. Outside the provider it is Notes and cannot change. */
export function useNotesView() {
  return useContext(ViewContext) ?? { view: "notes" as NotesView, setView: () => undefined };
}
