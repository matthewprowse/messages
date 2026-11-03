"use client";

// Laid out like Conversations: the list on the left third and the open note on the grey right two thirds, with no rule
// between them. On phones the list fills the screen and a note opens over it.

import { usePathname } from "next/navigation";
import { NoteList } from "@/components/note-list";
import { NotesProvider } from "@/components/notes-data";
import { NoteCaptureShortcut } from "@/components/note-capture";
import { NotesViewProvider } from "@/components/notes/list-view";
import { cn } from "@/lib/utils";

export default function NotesLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isDetail = /^\/notes\/[^/]+/.test(pathname);
  return (
    <NotesProvider>
      <NotesViewProvider>
        <NoteCaptureShortcut />
        <div className="flex h-full min-h-0">
          <aside className={cn("h-full w-full shrink-0 flex-col md:flex md:w-80 lg:w-1/3", isDetail ? "hidden" : "flex")}>
            <NoteList />
          </aside>
          <section className={cn("h-full w-full min-w-0 shrink-0 flex-col bg-muted/50 md:flex md:flex-1", isDetail ? "flex" : "hidden")}>{children}</section>
        </div>
      </NotesViewProvider>
    </NotesProvider>
  );
}
