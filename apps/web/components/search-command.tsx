"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { track, viaNext } from "@/lib/analytics";
import type { Contact, Thread } from "@/lib/types";
import { relTime } from "@/lib/format";
import { providerLabel } from "@/components/primitives";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { NEW_ITEM_EVENT, isTypingKey } from "@/components/new-menu";
import { Calendar, CalendarPlus, Inbox, Mail, Newspaper, NotebookPen, Paperclip, Settings, Users, type LucideIcon } from "lucide-react";
import { formatPhone } from "@/lib/format";

const DEBOUNCE_MS = 150;

function strip(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Every word of the query has to appear somewhere in the text, in any order.
function matches(words: string[], ...text: (string | undefined)[]) {
  const hay = text.join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

// Starts the preview just before the first match so the matched words are visible.
function snippet(text: string, word: string) {
  const at = text.toLowerCase().indexOf(word);
  return at > 24 ? `…${text.slice(at - 20)}` : text;
}

function titleOf(t: Thread, contactOf: (id: string) => Contact | undefined) {
  return t.isGroup ? t.groupName ?? "Group" : contactOf(t.participantIds[0])?.name ?? "Unknown";
}

function useDebounced<T>(value: T, ms: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

// Same two-line text as a row on the Conversations page: 20px title line, 4px gap, 16px detail line.
function Row({ title, detail, meta }: { title: string; detail?: string; meta?: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex h-5 items-center justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium">{title}</span>
        {meta && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{meta}</span>}
      </div>
      {detail && <div className="flex h-4 items-center"><span className="min-w-0 truncate text-xs">{detail}</span></div>}
    </div>
  );
}

const ITEM = "p-2 [&>svg:last-child]:hidden";

/** The places the palette and the G chord (G, then the letter) can jump to. */
export const GO_TO: { href: string; label: string; icon: LucideIcon; key: string }[] = [
  { href: "/briefing", label: "Summary", icon: Newspaper, key: "s" },
  { href: "/calendar", label: "Calendar", icon: Calendar, key: "c" },
  { href: "/inbox", label: "Conversations", icon: Inbox, key: "i" },
  { href: "/contacts", label: "Contacts", icon: Users, key: "o" },
  { href: "/attachments", label: "Attachments", icon: Paperclip, key: "a" },
  { href: "/notes", label: "Notes", icon: NotebookPen, key: "n" },
  { href: "/settings", label: "Settings", icon: Settings, key: "," },
];

/** The chord shown beside a place, in the palette and in rail tooltips. */
export const goToHint = (href: string) => {
  const place = GO_TO.find((g) => g.href === href);
  return place ? `G ${place.key.toUpperCase()}` : undefined;
};

// Actions that open a dialog owned by the New menu, which listens for this event.
const ACTIONS: { item: "email" | "event"; label: string; icon: LucideIcon }[] = [
  { item: "email", label: "New Email", icon: Mail },
  { item: "event", label: "New Event", icon: CalendarPlus },
];

// Search lives in a command palette rather than its own page. It opens from the rail or with ⌘K / Ctrl+K.
export function SearchCommand({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // G then a letter jumps to a place, as in Gmail. The second key has two seconds to arrive.
  useEffect(() => {
    let armedAt = 0;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTypingKey(e)) return;
      const key = e.key.toLowerCase();
      if (key === "g") {
        armedAt = Date.now();
        return;
      }
      const armed = Date.now() - armedAt < 2000;
      armedAt = 0;
      const place = armed ? GO_TO.find((g) => g.key === key) : undefined;
      if (!place) return;
      e.preventDefault();
      // The second key must not also reach another shortcut, such as C opening the New menu.
      e.stopImmediatePropagation();
      router.push(place.href);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [router]);

  return (
    // Top-aligned on phones so the keyboard does not cover the list; a third of the way down from sm up.
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Search conversations, contacts and messages." className="top-4 sm:top-1/3 sm:max-w-xl">
      {/* The dialog mounts this only while open, so a closed palette does no work and each search starts empty. */}
      <SearchResults onPick={() => onOpenChange(false)} />
    </CommandDialog>
  );
}

function SearchResults({ onPick }: { onPick: () => void }) {
  const router = useRouter();
  const { threads, contacts, messages, contactById: contactOf } = useApp();
  const [query, setQuery] = useState("");
  const term = useDebounced(query, DEBOUNCE_MS);

  // Deleted conversations (in the provider's bin) never show in search.
  const recent = useMemo(() => threads.filter((t) => t.status !== "trash").sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)), [threads]);
  const live = useMemo(() => new Map(recent.map((t) => [t.id, t])), [recent]);
  // Stripped and lowercased once per message list rather than on every search.
  const texts = useMemo(() => messages.map((m) => {
    const text = strip(m.body);
    return { m, text, hay: text.toLowerCase() };
  }), [messages]);

  const words = useMemo(() => term.toLowerCase().split(/\s+/).filter(Boolean), [term]);
  const places = useMemo(() => GO_TO.filter((g) => matches(words, g.label)), [words]);
  const actions = useMemo(() => ACTIONS.filter((a) => matches(words, a.label)), [words]);

  const results = useMemo(() => {
    if (words.length === 0) {
      return { conversations: recent.filter((t) => t.status === "inbox").slice(0, 6), contacts: [], messages: [] };
    }
    const people = contacts.filter((c) => matches(words, c.name, c.company, c.role, ...c.emails, ...c.phones)).slice(0, 5);
    // A person who matches shows once, as a contact. Their one-to-one conversations are not listed again.
    const shown = new Set(people.map((c) => c.id));
    const conversations = recent
      .filter((t) => {
        if (!t.isGroup && shown.has(t.participantIds[0])) return false;
        const members = t.participantIds.map(contactOf).filter((c): c is Contact => !!c);
        return matches(words, titleOf(t, contactOf), t.subject, providerLabel[t.provider], ...members.flatMap((c) => [c.name, ...c.emails, ...c.phones]));
      })
      .slice(0, 5);
    const hits = texts
      .filter(({ m, hay }) => live.has(m.threadId) && words.every((w) => hay.includes(w)))
      .sort((a, b) => b.m.sentAt.localeCompare(a.m.sentAt))
      .slice(0, 10)
      .map(({ m, text }) => ({ m, thread: live.get(m.threadId)!, snippet: snippet(text, words[0]) }));
    return { conversations, contacts: people, messages: hits };
  }, [words, recent, live, contacts, texts, contactOf]);

  // One search event when the palette closes: how long the query was, how many results it had, and which one was picked.
  const searched = useRef({ len: 0, results: 0, picked: 0 });
  useEffect(() => {
    const total = results.contacts.length + results.conversations.length + results.messages.length;
    if (term.trim()) searched.current = { ...searched.current, len: term.trim().length, results: total };
  }, [term, results]);
  useEffect(() => () => {
    const { len, results: count, picked } = searched.current;
    if (len > 0) track("search", { len, results: count, ...(picked > 0 ? { picked_rank: picked } : {}) });
  }, []);

  function go(href: string, rank: number) {
    searched.current.picked = rank;
    viaNext("search");
    onPick();
    router.push(href);
  }

  function act(item: "email" | "event") {
    onPick();
    // The New menu is mounted for the whole session; the event hands it the dialog to open.
    window.dispatchEvent(new CustomEvent(NEW_ITEM_EVENT, { detail: item }));
  }

  // A contact opens their most recent one-to-one conversation, or their contact page if there is none.
  function contactHref(c: Contact) {
    const t = recent.find((x) => !x.isGroup && x.participantIds[0] === c.id);
    return t ? `/inbox/${t.id}` : `/contacts/${c.id}`;
  }

  return (
    // Results are filtered here rather than by cmdk, whose fuzzy score matches almost every long message.
    <Command shouldFilter={false}>
      <CommandInput placeholder="Search Everything" value={query} onValueChange={setQuery} />
      <CommandList className="max-h-[50svh] sm:max-h-80">
        <CommandEmpty>No Results Found</CommandEmpty>
        {results.contacts.length > 0 && (
          <CommandGroup heading="Contacts">
            {results.contacts.map((c, i) => (
              <CommandItem key={c.id} value={`contact-${c.id}`} className={ITEM} onSelect={() => go(contactHref(c), i + 1)}>
                <Row title={c.name} detail={[c.emails[0] ?? (c.phones[0] && formatPhone(c.phones[0])), c.company].filter(Boolean).join(" · ")} />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {results.conversations.length > 0 && (
          <CommandGroup heading={term.trim() ? "Conversations" : "Recent"}>
            {results.conversations.map((t, i) => (
              // Same second line as the conversation's row: the subject of an email, the latest message of a chat.
              <CommandItem key={t.id} value={`thread-${t.id}`} className={ITEM} onSelect={() => go(`/inbox/${t.id}`, results.contacts.length + i + 1)}>
                <Row title={titleOf(t, contactOf)} detail={t.channel === "email" ? t.subject : t.preview} meta={relTime(t.lastMessageAt)} />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {results.messages.length > 0 && (
          <CommandGroup heading="Messages">
            {results.messages.map(({ m, thread: t, snippet: text }, i) => {
              const sender = m.from === "me" ? "You" : t.isGroup ? contactOf(m.from)?.name.split(" ")[0] : undefined;
              return (
                <CommandItem key={m.id} value={`message-${m.id}`} className={ITEM} onSelect={() => go(`/inbox/${t.id}?message=${m.id}`, results.contacts.length + results.conversations.length + i + 1)}>
                  <Row title={titleOf(t, contactOf)} detail={sender ? `${sender}: ${text}` : text} meta={relTime(m.sentAt)} />
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {places.length > 0 && (
          <CommandGroup heading="Go To">
            {places.map(({ href, label, icon: Icon }) => (
              <CommandItem key={href} value={`go-${href}`} className={ITEM} onSelect={() => { onPick(); router.push(href); }}>
                <Icon />
                {label}
                <CommandShortcut>{goToHint(href)}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {actions.length > 0 && (
          <CommandGroup heading="Actions">
            {actions.map(({ item, label, icon: Icon }) => (
              <CommandItem key={item} value={`action-${item}`} className={ITEM} onSelect={() => act(item)}>
                <Icon />
                {label}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}

const SHORTCUTS: { heading: string; rows: { label: string; keys: string[] }[] }[] = [
  {
    heading: "Anywhere",
    rows: [
      { label: "Search", keys: ["⌘", "K"] },
      { label: "New Email, Event or Message", keys: ["C"] },
      ...GO_TO.map((g) => ({ label: `Go To ${g.label}`, keys: ["G", "then", g.key.toUpperCase()] })),
      { label: "Keyboard Shortcuts", keys: ["?"] },
    ],
  },
  {
    heading: "Lists",
    rows: [
      { label: "Next Row", keys: ["J"] },
      { label: "Previous Row", keys: ["K"] },
      { label: "Open Row", keys: ["Enter"] },
      { label: "Clear Selection", keys: ["Esc"] },
    ],
  },
  {
    heading: "Conversations",
    rows: [
      { label: "Archive", keys: ["E"] },
      { label: "Delete", keys: ["#"] },
      { label: "Mark as Junk", keys: ["!"] },
      { label: "Mark as Unread", keys: ["U"] },
      { label: "Back to the List", keys: ["Esc"] },
      { label: "Send a Reply", keys: ["⌘", "Enter"] },
    ],
  },
  {
    heading: "Attachments",
    rows: [
      { label: "Zoom In or Out", keys: ["+", "-"] },
      { label: "Reset Zoom", keys: ["0"] },
    ],
  },
];

/** Pressing ? outside a field lists the keyboard shortcuts. */
export function ShortcutsDialog() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTypingKey(e)) return;
      e.preventDefault();
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showCloseButton={false} className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>Shortcuts work when you are not typing in a field.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {SHORTCUTS.map(({ heading, rows }) => (
            <section key={heading} className="grid gap-2">
              <h2 className="text-xs font-medium text-muted-foreground">{heading}</h2>
              {rows.map(({ label, keys }) => (
                <div key={label} className="flex items-center justify-between gap-4">
                  <span>{label}</span>
                  <KbdGroup>
                    {keys.map((k, i) => (k === "then" ? <span key={i} className="text-xs text-muted-foreground">then</span> : <Kbd key={i}>{k}</Kbd>))}
                  </KbdGroup>
                </div>
              ))}
            </section>
          ))}
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
