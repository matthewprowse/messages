"use client";

// The Notes chip other pages mount: a button with the number of notes linked to a contact, conversation or event,
// opening a list of them and a New Note that is linked to it already. Works on any screen (it does not need the
// Notes page's provider); the list is read when the chip is shown (from memory when read in the last two minutes, see
// lib/note-links.ts) and again each time it opens. A chip hidden by CSS (phones) reads nothing. NotesMenuItem is the
// same list as a submenu, for headers that fold the chip into their More menu on phones.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { NotebookPen, Plus } from "lucide-react";
import { cachedLinkedNotes, loadLinkedNotesCached, type LinkedNote } from "@/lib/note-links";
import type { LinkKind } from "@/lib/note-link-map";
import { relTime } from "@/lib/format";
import { useCaptureNote } from "@/components/note-capture";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The notes linked to something, kept from the last read and read again once `enabled` when old, and always whenever
 * `fresh` turns true (the list opening). Null while loading with nothing kept.
 */
function useLinkedNotes(kind: LinkKind, id: string, fresh: boolean, enabled = true) {
  const [notes, setNotes] = useState<LinkedNote[] | null>(() => cachedLinkedNotes({ kind, id }) ?? null);
  useEffect(() => {
    setNotes(cachedLinkedNotes({ kind, id }) ?? null);
    if (!enabled && !fresh) return;
    let cancelled = false;
    loadLinkedNotesCached({ kind, id }, fresh ? 0 : undefined)
      .then((list) => { if (!cancelled) setNotes(list); })
      .catch(() => { if (!cancelled) setNotes((n) => n ?? []); });
    return () => { cancelled = true; };
  }, [kind, id, fresh, enabled]);
  return notes;
}

/** Whether an element takes up space: false while CSS hides it (display: none at a breakpoint). */
function useShown<T extends Element>() {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setShown(el.getClientRects().length > 0);
    check();
    // Fires when the element is hidden or shown again as the window crosses a breakpoint.
    const watcher = new ResizeObserver(check);
    watcher.observe(el);
    return () => watcher.disconnect();
  }, []);
  return [ref, shown] as const;
}

interface Props { kind: LinkKind; id: string; /** The title a new note from here starts with, such as a conversation's subject. */ title?: string }

export function NotesChip({ kind, id, title, className }: Props & { className?: string }) {
  const capture = useCaptureNote();
  const [open, setOpen] = useState(false);
  const [trigger, shown] = useShown<HTMLButtonElement>();
  const notes = useLinkedNotes(kind, id, open, shown);
  const count = notes?.length ?? 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button ref={trigger} variant="ghost" size="icon" className={className} aria-label={count ? `Notes, ${count}` : "Notes"}><NotebookPen /></Button>
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
  const notes = useLinkedNotes(kind, id, true);
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
