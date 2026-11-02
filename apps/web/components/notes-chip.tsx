"use client";

// The Notes chip other pages mount: a button with the number of notes linked to a contact, conversation or event,
// opening a list of them and a New Note that is linked to it already. Works on any screen (it does not need the
// Notes page's provider); the list is read when the chip appears and again each time it opens.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { NotebookPen, Plus } from "lucide-react";
import { loadLinkedNotes, type LinkedNote } from "@/lib/note-links";
import type { LinkKind } from "@/lib/note-link-map";
import { relTime } from "@/lib/format";
import { useCaptureNote } from "@/components/note-capture";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function NotesChip({ kind, id, title }: { kind: LinkKind; id: string; /** The title a new note from here starts with, such as a conversation's subject. */ title?: string }) {
  const capture = useCaptureNote();
  const [notes, setNotes] = useState<LinkedNote[] | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => {
    let cancelled = false;
    loadLinkedNotes({ kind, id }).then((list) => { if (!cancelled) setNotes(list); }).catch(() => { if (!cancelled) setNotes((n) => n ?? []); });
    return () => { cancelled = true; };
  }, [kind, id]);
  useEffect(() => { setNotes(null); return load(); }, [load]);
  useEffect(() => (open ? load() : undefined), [open, load]);
  const count = notes?.length ?? 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" aria-label={count ? `Notes, ${count}` : "Notes"}><NotebookPen />Notes{count > 0 && <span className="tabular-nums text-muted-foreground">{count}</span>}</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-72 flex-col gap-1 p-1">
        {notes === null && <p className="px-2 py-1.5 text-sm text-muted-foreground" role="status">Loading</p>}
        {notes?.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">No notes yet.</p>}
        {notes?.map((n) => (
          <Link key={n.id} href={`/notes/${n.id}`} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm outline-none hover:bg-muted focus-visible:bg-muted">
            <span className="truncate">{n.title.trim() || "Untitled Note"}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{relTime(n.updatedAt)}</span>
          </Link>
        ))}
        <Button variant="ghost" className="justify-start" onClick={() => { setOpen(false); void capture({ title, links: [{ kind, id }] }); }}><Plus />New Note</Button>
      </PopoverContent>
    </Popover>
  );
}
