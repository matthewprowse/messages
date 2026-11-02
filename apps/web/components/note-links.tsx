"use client";

// A note's links in the open note: the chips under the title (each opens the contact, conversation or calendar) and
// the Link menu in the header that picks a contact, conversation or event to add. Links are rows of their own
// (lib/note-links.ts), loaded when the note opens and changed at once, put back with a toast if saving fails.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, Link2, MessageSquare, User, X } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import { loadEventDetail, loadEvents } from "@/lib/calendar";
import { addNoteLinks, loadNoteLinks, removeNoteLink } from "@/lib/note-links";
import { linkHref, linkKey, threadLabel, type LinkKind, type LinkTarget } from "@/lib/note-link-map";
import { noteReady } from "@/components/notes-data";
import { longDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const ICON = { contact: User, thread: MessageSquare, event: CalendarDays } as const;
/** The picker shows this many matches per group, so a big address book is not drawn all at once. */
const SHOWN = 6;

/** A note's links, with add and remove. */
export function useNoteLinks(noteId: string) {
  const [links, setLinks] = useState<LinkTarget[]>([]);
  useEffect(() => {
    let cancelled = false;
    setLinks([]);
    noteReady(noteId).then(() => loadNoteLinks(noteId)).then((rows) => { if (!cancelled) setLinks(rows.map((r) => r.target)); }).catch(() => {});
    return () => { cancelled = true; };
  }, [noteId]);

  const add = useCallback((target: LinkTarget) => {
    setLinks((l) => (l.some((x) => linkKey(x) === linkKey(target)) ? l : [...l, target]));
    noteReady(noteId).then(() => addNoteLinks(noteId, [target])).catch(() => {
      setLinks((l) => l.filter((x) => linkKey(x) !== linkKey(target)));
      toast.error("Could not link the note.");
    });
  }, [noteId]);

  const remove = useCallback((target: LinkTarget) => {
    setLinks((l) => l.filter((x) => linkKey(x) !== linkKey(target)));
    removeNoteLink(noteId, target).catch(() => {
      setLinks((l) => (l.some((x) => linkKey(x) === linkKey(target)) ? l : [...l, target]));
      toast.error("Could not remove the link.");
    });
  }, [noteId]);

  return { links, add, remove };
}

// Event titles looked up for chips, kept for the visit so a chip does not fetch twice.
const eventTitles = new Map<string, string>();

/** The name a link shows: the person, the conversation's subject or name, or the event's title. */
export function useLinkLabel(target: LinkTarget): string {
  const { contactById, threadById } = useApp();
  const [event, setEvent] = useState(() => eventTitles.get(target.id) ?? "");
  useEffect(() => {
    if (target.kind !== "event" || eventTitles.has(target.id)) return;
    let cancelled = false;
    loadEventDetail(target.id).then((e) => {
      const title = e?.title.trim() || "Event";
      eventTitles.set(target.id, title);
      if (!cancelled) setEvent(title);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [target.kind, target.id]);
  if (target.kind === "contact") return contactById(target.id)?.name || "Contact";
  if (target.kind === "event") return event || "Event";
  const t = threadById(target.id);
  return t ? threadLabel(t, (id) => contactById(id)?.name) : "Conversation";
}

function LinkChip({ target, onRemove }: { target: LinkTarget; onRemove: (t: LinkTarget) => void }) {
  const label = useLinkLabel(target);
  const Icon = ICON[target.kind];
  return (
    <Badge variant="secondary" className="max-w-full gap-1 pr-1">
      <Link href={linkHref(target)} className="flex min-w-0 items-center gap-1 outline-none focus-visible:underline">
        <Icon className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </Link>
      <button type="button" aria-label={`Remove Link to ${label}`} onClick={() => onRemove(target)} className="rounded-sm p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
        <X className="size-3" />
      </button>
    </Badge>
  );
}

/** The chips under the title; nothing when the note has no links. */
export function LinkChips({ links, onRemove }: { links: LinkTarget[]; onRemove: (t: LinkTarget) => void }) {
  if (links.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Linked To">
      {links.map((t) => <LinkChip key={linkKey(t)} target={t} onRemove={onRemove} />)}
    </div>
  );
}

/** The header button: search your contacts, conversations and recent or coming events, and link one. */
export function LinkMenu({ links, onAdd }: { links: LinkTarget[]; onAdd: (t: LinkTarget) => void }) {
  const { contacts, threads, contactById } = useApp();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [events, setEvents] = useState<{ id: string; title: string; startsAt: string }[] | null>(null);

  // Events are read when the menu first opens: a month back to two months ahead covers the meetings a note is about.
  useEffect(() => {
    if (!open || events) return;
    let cancelled = false;
    const now = Date.now();
    loadEvents(new Date(now - 30 * 86_400_000), new Date(now + 60 * 86_400_000), { details: false })
      .then((list) => { if (!cancelled) setEvents(list.map((e) => ({ id: e.id, title: e.title.trim() || "Event", startsAt: e.startsAt }))); })
      .catch(() => { if (!cancelled) setEvents([]); });
    return () => { cancelled = true; };
  }, [open, events]);

  const linked = useMemo(() => new Set(links.map(linkKey)), [links]);
  const q = term.trim().toLowerCase();
  const matches = (s: string) => !q || s.toLowerCase().includes(q);
  const people = useMemo(() => contacts.filter((c) => !linked.has(`contact:${c.id}`) && matches(c.name)).slice(0, SHOWN), [contacts, linked, q]);
  const chats = useMemo(() => threads.map((t) => ({ id: t.id, label: threadLabel(t, (id) => contactById(id)?.name) })).filter((t) => !linked.has(`thread:${t.id}`) && matches(t.label)).slice(0, SHOWN), [threads, linked, q, contactById]);
  const dates = useMemo(() => (events ?? []).filter((e) => !linked.has(`event:${e.id}`) && matches(e.title)).slice(0, SHOWN), [events, linked, q]);

  const pick = (kind: LinkKind, id: string) => {
    onAdd({ kind, id });
    setOpen(false);
    setTerm("");
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button variant="secondary" aria-label="Link Note"><Link2 />Link</Button></PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <Command shouldFilter={false}>
          <CommandInput value={term} onValueChange={setTerm} placeholder="Link to a Person, Chat or Event" />
          <CommandList>
            <CommandEmpty>{events ? "No Matches" : "Searching"}</CommandEmpty>
            {people.length > 0 && <CommandGroup heading="People">{people.map((c) => <CommandItem key={c.id} value={`contact:${c.id}`} onSelect={() => pick("contact", c.id)}><User />{c.name}</CommandItem>)}</CommandGroup>}
            {chats.length > 0 && <CommandGroup heading="Conversations">{chats.map((t) => <CommandItem key={t.id} value={`thread:${t.id}`} onSelect={() => pick("thread", t.id)}><MessageSquare /><span className="truncate">{t.label}</span></CommandItem>)}</CommandGroup>}
            {dates.length > 0 && <CommandGroup heading="Events">{dates.map((e) => <CommandItem key={e.id} value={`event:${e.id}`} onSelect={() => pick("event", e.id)}><CalendarDays /><span className="truncate">{e.title}</span><span className="ml-auto shrink-0 text-xs text-muted-foreground">{longDate(e.startsAt)}</span></CommandItem>)}</CommandGroup>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
