"use client";

// The Notes chip other pages mount: a button with the number of notes linked to a contact, conversation or event,
// opening a list of them and a New Note that is linked to it already. Works on any screen (it does not need the
// Notes page's provider); the list is read when the chip appears and again each time it opens. NotesMenuItem is the
// same list as a submenu, for headers that fold the chip into their More menu on phones.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { NotebookPen, Plus } from "lucide-react";
import { loadLinkedNotes, type LinkedNote } from "@/lib/note-links";
import type { LinkKind } from "@/lib/note-link-map";
import { relTime } from "@/lib/format";
import { useCaptureNote } from "@/components/note-capture";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** The notes linked to something, read on mount and again whenever `fresh` turns true (the list opening). Null while loading. */
function useLinkedNotes(kind: LinkKind, id: string, fresh: boolean) {
  const [notes, setNotes] = useState<LinkedNote[] | null>(null);
  const load = useCallback(() => {
    let cancelled = false;
    loadLinkedNotes({ kind, id }).then((list) => { if (!cancelled) setNotes(list); }).catch(() => { if (!cancelled) setNotes((n) => n ?? []); });
    return () => { cancelled = true; };
  }, [kind, id]);
  useEffect(() => { setNotes(null); return load(); }, [load]);
  useEffect(() => (fresh ? load() : undefined), [fresh, load]);
  return notes;
}

interface Props { kind: LinkKind; id: string; /** The title a new note from here starts with, such as a conversation's subject. */ title?: string }

export function NotesChip({ kind, id, title, className }: Props & { className?: string }) {
  const capture = useCaptureNote();
  const [open, setOpen] = useState(false);
  const notes = useLinkedNotes(kind, id, open);
  const count = notes?.length ?? 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className={className} aria-label={count ? `Notes, ${count}` : "Notes"}><NotebookPen /></Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Notes</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="flex w-72 flex-col gap-1 p-1">
        {notes === null && <p className="px-2 py-1.5 text-sm text-muted-foreground" role="status">Loading</p>}
        {notes?.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">No notes yet.</p>}
        {notes?.map((n) => (
          <Link key={n.id} href={`/notes/${n.id}`} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm outline-none hover:bg-muted focus-visible:bg-muted">
            <span className="truncate">{n.title.trim() || "Untitled Note"}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{relTime(n.updatedAt)}</span>
          </Link>
        ))}
        <Button variant="secondary" className="justify-start" onClick={() => { setOpen(false); void capture({ title, links: [{ kind, id }] }); }}><Plus />New Note</Button>
      </PopoverContent>
    </Popover>
  );
}

/** The same list as a submenu, for a More menu on phones where the chip does not fit. Read when the submenu mounts (the menu opening). */
function NotesSubContent({ kind, id, title }: Props) {
  const capture = useCaptureNote();
  const notes = useLinkedNotes(kind, id, false);
  return (
    <DropdownMenuSubContent className="w-64">
      {notes === null && <DropdownMenuItem disabled>Loading</DropdownMenuItem>}
      {notes?.length === 0 && <DropdownMenuItem disabled>No notes yet.</DropdownMenuItem>}
      {notes?.map((n) => (
        <DropdownMenuItem key={n.id} asChild>
          <Link href={`/notes/${n.id}`}>
            <span className="min-w-0 flex-1 truncate">{n.title.trim() || "Untitled Note"}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{relTime(n.updatedAt)}</span>
          </Link>
        </DropdownMenuItem>
      ))}
      {notes && notes.length > 0 && <DropdownMenuSeparator />}
      <DropdownMenuItem onSelect={() => void capture({ title, links: [{ kind, id }] })}>New Note</DropdownMenuItem>
    </DropdownMenuSubContent>
  );
}

/** Notes as a More menu entry. `className` lets a caller show it only where the chip is hidden. */
export function NotesMenuItem({ className, ...props }: Props & { className?: string }) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={className}>Notes</DropdownMenuSubTrigger>
      <NotesSubContent {...props} />
    </DropdownMenuSub>
  );
}
