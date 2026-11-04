"use client";

// The search palette and the shortcuts dialog. The palette jumps to pages and settings, and searches everything through the
// private index in lib/search (conversations, messages, contacts, notes, events, tasks and files, with operators). Mounting
// it also starts that index, from the first idle moment, whether or not the palette is ever opened.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { track, viaNext } from "@/lib/analytics";
import type { Contact, Thread } from "@/lib/types";
import { fullDate, relTime } from "@/lib/format";
import { ContactAvatar, ThreadAvatar, providerLabel } from "@/components/primitives";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { NEW_ITEM_EVENT, isTypingKey } from "@/components/new-menu";
import { Calendar, CalendarPlus, Inbox, ListChecks, Mail, MessageCircle, Newspaper, NotebookPen, Paperclip, Settings, Users, type LucideIcon } from "lucide-react";
import { formatPhone } from "@/lib/format";
import { parseQuery } from "@/lib/search/query";
import { useIndexProgress } from "@/lib/search/status";
import { useSearchIndexer } from "@/lib/search/use-indexer";
import { useIndexResults } from "@/lib/search/use-search";
import type { Doc, Hit, Kind } from "@/lib/search/types";

const DEBOUNCE_MS = 150;

// Every word of the query has to appear somewhere in the text, in any order.
function matches(words: string[], ...text: (string | undefined)[]) {
  const hay = text.join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
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

// Same two-line text as a row on the Conversations page: 20px title line, 4px gap, 16px detail line, with the person's photo.
function Row({ avatar, title, detail, meta }: { avatar?: ReactNode; title: string; detail?: string; meta?: string }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      {avatar}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex h-5 items-center justify-between gap-3">
          <span className="min-w-0 truncate text-sm font-medium">{title}</span>
          {meta && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{meta}</span>}
        </div>
        {detail && <div className="flex h-4 items-center"><span className="min-w-0 truncate text-xs">{detail}</span></div>}
      </div>
    </div>
  );
}

const ITEM = "p-2 [&>svg:last-child]:hidden";

/** The places the palette and the G chord (G, then the letter) can jump to. */
export const GO_TO: { href: string; label: string; icon: LucideIcon; key: string }[] = [
  { href: "/summary", label: "Summary", icon: Newspaper, key: "s" },
  { href: "/calendar", label: "Calendar", icon: Calendar, key: "c" },
  { href: "/inbox", label: "Conversations", icon: Inbox, key: "i" },
  { href: "/contacts", label: "Contacts", icon: Users, key: "o" },
  { href: "/attachments", label: "Attachments", icon: Paperclip, key: "a" },
  { href: "/notes", label: "Notes", icon: NotebookPen, key: "n" },
  { href: "/settings", label: "Settings", icon: Settings, key: "," },
];

// Settings pages the palette can open directly. Keywords are other ways to spell or name the page.
const SETTINGS_PAGES: { href: string; label: string; keywords?: string }[] = [
  { href: "/settings/accounts", label: "Connected Accounts", keywords: "connectors connect email whatsapp calendar linkedin instagram sending signatures" },
  { href: "/settings/ai", label: "AI", keywords: "personalisation personalization voice tone writing style priorities rules brief" },
  { href: "/settings/drafts", label: "Drafts", keywords: "templates snippets learned style" },
  { href: "/settings/automations", label: "Automations", keywords: "rules automation leads" },
  { href: "/settings/notifications", label: "Notifications", keywords: "alerts push quiet hours" },
  { href: "/settings/profile", label: "Profile", keywords: "name photo account appearance theme dark light sign in two factor sessions" },
  { href: "/settings/privacy", label: "Privacy and Data", keywords: "export download delete privacy data" },
  { href: "/settings/usage", label: "Usage", keywords: "billing plan cost storage" },
  { href: "/settings/team", label: "Team", keywords: "workspace members sharing" },
  { href: "/settings/whats-new", label: "What's New", keywords: "updates changelog release" },
];

/** The chord shown beside a place, in the palette and in rail tooltips. */
export const goToHint = (href: string) => {
  const place = GO_TO.find((g) => g.href === href);
  return place ? `G ${place.key.toUpperCase()}` : undefined;
};

// Actions that open a dialog owned by the New menu, which listens for this event.
type ActionItem = "email" | "whatsapp" | "linkedin" | "instagram" | "event";
const ACTIONS: { item: ActionItem; label: string; icon: LucideIcon }[] = [
  { item: "email", label: "New Email", icon: Mail },
  { item: "whatsapp", label: "New WhatsApp Message", icon: MessageCircle },
  { item: "linkedin", label: "New LinkedIn Message", icon: MessageCircle },
  { item: "instagram", label: "New Instagram Message", icon: MessageCircle },
  { item: "event", label: "New Event", icon: CalendarPlus },
];

// Search lives in a command palette rather than its own page. It opens from the rail or with ⌘K / Ctrl+K.
export function SearchCommand({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  useSearchIndexer();

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
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Search conversations, messages, contacts, notes, events, tasks and files." className="top-[calc(env(safe-area-inset-top)+1rem)] sm:top-1/3 sm:max-w-xl">
      {/* The dialog mounts this only while open, so a closed palette does no work and each search starts empty. */}
      <SearchResults onPick={() => onOpenChange(false)} />
    </CommandDialog>
  );
}

/** A round icon where a photo would be, for results with no person to show (a note, a file, a conversation not loaded here). */
function IconBadge({ icon: Icon }: { icon: LucideIcon }) {
  return <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" /></span>;
}

const when = (at: number) => new Date(at).toISOString();

function SearchResults({ onPick }: { onPick: () => void }) {
  const router = useRouter();
  const { threads, contacts, contactById: contactOf, threadById, ensureThread } = useApp();
  const [query, setQuery] = useState("");
  const term = useDebounced(query, DEBOUNCE_MS);
  const progress = useIndexProgress();

  // Deleted conversations (in the provider's bin) never show in search.
  const recent = useMemo(() => threads.filter((t) => t.status !== "trash").sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)), [threads]);
  const parsed = useMemo(() => parseQuery(term), [term]);
  const words = parsed.terms;
  const places = useMemo(() => GO_TO.filter((g) => matches(words, g.label)), [words]);
  // Settings pages only show once something is typed, so the empty palette stays a short list.
  const settingsPages = useMemo(() => (words.length ? SETTINGS_PAGES.filter((s) => matches(words, s.label, s.keywords, "settings")) : []), [words]);
  const actions = useMemo(() => ACTIONS.filter((a) => matches(words, a.label)), [words]);

  // The index finds everything, loaded or not. Until it is open (the first moments of a session) what the app holds is searched instead.
  const indexed = useIndexResults(term);
  const fallback = useMemo(() => {
    if (indexed || words.length === 0) return null;
    const people = contacts.filter((c) => matches(words, c.name, c.company, c.role, ...c.emails, ...c.phones)).slice(0, 5);
    const conversations = recent.filter((t) => matches(words, titleOf(t, contactOf), t.subject, providerLabel[t.provider])).slice(0, 5);
    return { people, conversations };
  }, [indexed, words, contacts, recent, contactOf]);
  // With nothing typed: the latest conversations. With an operator and no words the index answers instead.
  const recents = useMemo(() => (term.trim() ? [] : recent.filter((t) => t.status === "inbox").slice(0, 6)), [term, recent]);

  const groups = useMemo(() => {
    const hits = (kind: Kind): Hit[] => indexed?.[kind].hits ?? [];
    const contactHits = hits("contact");
    // A person who matches shows once, as a contact. Their one-to-one conversations are not listed again.
    const shown = new Set(contactHits.map((h) => h.doc.r));
    const conversations = hits("thread").filter((h) => {
      const t = threadById(h.doc.r);
      return !(t && !t.isGroup && shown.has(t.participantIds[0]));
    });
    return { thread: conversations, message: hits("message"), contact: contactHits, note: hits("note"), event: hits("event"), task: hits("task"), file: hits("file") };
  }, [indexed, threadById]);

  // One search event when the palette closes: how long the query was, how many results it had, and which one was picked. Never the text.
  const searched = useRef({ len: 0, results: 0, picked: 0 });
  useEffect(() => {
    const total = indexed ? Object.values(indexed).reduce((n, g) => n + g.total, 0) : (fallback?.people.length ?? 0) + (fallback?.conversations.length ?? 0);
    if (term.trim()) searched.current = { ...searched.current, len: term.trim().length, results: total };
  }, [term, indexed, fallback]);
  useEffect(() => () => {
    const { len, results: count, picked } = searched.current;
    if (len > 0) track("search", { len, results: count, ...(picked > 0 ? { picked_rank: picked } : {}) });
  }, []);

  // A result in a conversation older than the 1,000 the list holds loads that conversation first, or the page would say it is not found.
  async function go(href: string, rank: number, threadId?: string) {
    searched.current.picked = rank;
    viaNext("search");
    onPick();
    if (threadId && !threadById(threadId)) await ensureThread(threadId).catch(() => false);
    router.push(href);
  }

  function act(item: ActionItem) {
    onPick();
    // The New menu is mounted for the whole session; the event hands it the dialog to open.
    window.dispatchEvent(new CustomEvent(NEW_ITEM_EVENT, { detail: item }));
  }

  // A contact opens their most recent one-to-one conversation, or their contact page if there is none.
  function contactHref(id: string) {
    const t = recent.find((x) => !x.isGroup && x.participantIds[0] === id);
    return t ? `/inbox/${t.id}` : `/contacts/${id}`;
  }

  // The conversation a result belongs to, as the Inbox shows it when it is loaded; otherwise what the index kept.
  const threadOf = (doc: Doc) => threadById(doc.k === "thread" ? doc.r : doc.th ?? "");
  const nameFor = (doc: Doc) => {
    const t = threadOf(doc);
    if (t) return titleOf(t, contactOf);
    return doc.k === "thread" ? doc.t : doc.fr?.split(" ").slice(0, 2).join(" ") || doc.t || "Conversation";
  };
  const avatarFor = (doc: Doc) => {
    const t = threadOf(doc);
    return t ? <ThreadAvatar thread={t} contacts={contactOf} className="size-8" /> : <IconBadge icon={MessageCircle} />;
  };

  const goTo = (places.length > 0 || settingsPages.length > 0) && (
    <CommandGroup heading="Go To">
      {places.map(({ href, label, icon: Icon }) => (
        <CommandItem key={href} value={`go-${href}`} className={ITEM} onSelect={() => { onPick(); router.push(href); }}>
          <Icon />
          {label}
          <CommandShortcut>{goToHint(href)}</CommandShortcut>
        </CommandItem>
      ))}
      {settingsPages.map(({ href, label }) => (
        <CommandItem key={href} value={`go-${href}`} className={ITEM} onSelect={() => { onPick(); router.push(href); }}>
          <Settings />
          {label}
          <CommandShortcut className="tracking-normal">Settings</CommandShortcut>
        </CommandItem>
      ))}
    </CommandGroup>
  );
  const doActions = actions.length > 0 && (
    <CommandGroup heading="Actions">
      {actions.map(({ item, label, icon: Icon }) => (
        <CommandItem key={item} value={`action-${item}`} className={ITEM} onSelect={() => act(item)}>
          <Icon />
          {label}
        </CommandItem>
      ))}
    </CommandGroup>
  );

  // Ranks count down the list in the order it is drawn, for the analytics event.
  let rank = 0;
  const building = progress.building && progress.total !== null && progress.indexed < progress.total;

  return (
    // Results are filtered here rather than by cmdk, whose fuzzy score matches almost every long message.
    <Command shouldFilter={false}>
      <CommandInput placeholder="Search Everything" value={query} onValueChange={setQuery} groupClassName="h-8!" />
      <CommandList className="max-h-[50svh] sm:max-h-80">
        <CommandEmpty>No Results Found</CommandEmpty>
        {/* Pages and actions lead once something is typed, so Enter opens the page you named instead of a message that mentions it. */}
        {words.length > 0 && <>{goTo}{doActions}</>}
        {groups.thread.length > 0 && (
          <CommandGroup heading="Conversations">
            {groups.thread.map(({ doc }) => {
              const t = threadOf(doc);
              return (
                // Same second line as the conversation's row: the subject of an email, the latest message of a chat.
                <CommandItem key={doc.id} value={doc.id} className={ITEM} onSelect={() => go(`/inbox/${doc.r}`, ++rank, doc.r)}>
                  <Row avatar={avatarFor(doc)} title={nameFor(doc)} detail={t ? (t.channel === "email" ? t.subject : t.preview) : doc.x.slice(0, 120)} meta={doc.at ? relTime(when(doc.at)) : undefined} />
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {groups.message.length > 0 && (
          <CommandGroup heading="Messages">
            {groups.message.map(({ doc, snippet }) => {
              const sender = doc.me ? "You" : threadOf(doc)?.isGroup ? doc.fr?.split(" ")[0] : undefined;
              // An email's subject leads, then the words around the match.
              const text = [doc.t, snippet].filter(Boolean).join(" · ");
              return (
                <CommandItem key={doc.id} value={doc.id} className={ITEM} onSelect={() => go(`/inbox/${doc.th}?message=${doc.r}`, ++rank, doc.th)}>
                  <Row avatar={avatarFor(doc)} title={nameFor(doc)} detail={sender ? `${sender}: ${text}` : text} meta={relTime(when(doc.at))} />
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {groups.contact.length > 0 && (
          <CommandGroup heading="Contacts">
            {groups.contact.map(({ doc }) => {
              const c = contactOf(doc.r);
              return (
                <CommandItem key={doc.id} value={doc.id} className={ITEM} onSelect={() => go(contactHref(doc.r), ++rank)}>
                  <Row avatar={c ? <ContactAvatar contact={c} className="size-8" /> : <IconBadge icon={Users} />} title={doc.t} detail={c ? [c.emails[0] ?? (c.phones[0] && formatPhone(c.phones[0])), c.company].filter(Boolean).join(" · ") : doc.x.slice(0, 80)} />
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {groups.note.length > 0 && (
          <CommandGroup heading="Notes">
            {groups.note.map(({ doc, snippet }) => (
              <CommandItem key={doc.id} value={doc.id} className={ITEM} onSelect={() => go(`/notes/${doc.r}`, ++rank)}>
                <Row avatar={<IconBadge icon={NotebookPen} />} title={doc.t} detail={snippet} meta={doc.at ? relTime(when(doc.at)) : undefined} />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {groups.event.length > 0 && (
          <CommandGroup heading="Events">
            {groups.event.map(({ doc, snippet }) => (
              <CommandItem key={doc.id} value={doc.id} className={ITEM} onSelect={() => go(`/calendar?event=${doc.r}`, ++rank)}>
                <Row avatar={<IconBadge icon={Calendar} />} title={doc.t} detail={snippet} meta={doc.at ? fullDate(when(doc.at)) : undefined} />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {groups.task.length > 0 && (
          <CommandGroup heading="Tasks">
            {groups.task.map(({ doc, snippet }) => (
              <CommandItem key={doc.id} value={doc.id} className={ITEM} onSelect={() => go(`/calendar?task=${doc.r}`, ++rank)}>
                <Row avatar={<IconBadge icon={ListChecks} />} title={doc.t} detail={[doc.d ? "Done" : "", snippet].filter(Boolean).join(" · ")} meta={doc.at ? fullDate(when(doc.at)) : undefined} />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {groups.file.length > 0 && (
          <CommandGroup heading="Files">
            {groups.file.map(({ doc }) => (
              <CommandItem key={doc.id} value={doc.id} className={ITEM} onSelect={() => go(`/inbox/${doc.th}?message=${doc.mi}`, ++rank, doc.th)}>
                <Row avatar={<IconBadge icon={Paperclip} />} title={doc.t} detail={nameFor(doc)} meta={relTime(when(doc.at))} />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {/* Before the index has answered: what the app already holds, so the first keystrokes of a session still find people and chats. */}
        {fallback && fallback.people.length > 0 && (
          <CommandGroup heading="Contacts">
            {fallback.people.map((c, i) => (
              <CommandItem key={c.id} value={`contact-${c.id}`} className={ITEM} onSelect={() => go(contactHref(c.id), i + 1)}>
                <Row avatar={<ContactAvatar contact={c} className="size-8" />} title={c.name} detail={[c.emails[0] ?? (c.phones[0] && formatPhone(c.phones[0])), c.company].filter(Boolean).join(" · ")} />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {(fallback ? fallback.conversations : recents).length > 0 && (
          <CommandGroup heading={fallback ? "Conversations" : "Recent"}>
            {(fallback ? fallback.conversations : recents).map((t, i) => (
              <CommandItem key={t.id} value={`thread-${t.id}`} className={ITEM} onSelect={() => go(`/inbox/${t.id}`, i + 1)}>
                <Row avatar={<ThreadAvatar thread={t} contacts={contactOf} className="size-8" />} title={titleOf(t, contactOf)} detail={t.channel === "email" ? t.subject : t.preview} meta={relTime(t.lastMessageAt)} />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {words.length === 0 && <>{goTo}{doActions}</>}
      </CommandList>
      {/* The first build reads the whole history, so say how far along it is; once done, say what the box understands. */}
      <p className="border-t px-3 py-2 text-xs text-muted-foreground">
        {building ? `Indexing ${progress.indexed.toLocaleString()} of ${progress.total!.toLocaleString()}` : "Try from:, to:, has:attachment, is:unread, before: or after:"}
      </p>
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
    heading: "Conversations",
    rows: [
      { label: "Open the Next or Previous", keys: ["J", "K"] },
      { label: "Open the First", keys: ["Enter"] },
      { label: "Archive", keys: ["E"] },
      { label: "Delete", keys: ["#"] },
      { label: "Move to Junk", keys: ["!"] },
      { label: "Mark as Read or Unread", keys: ["U"] },
      { label: "Reply", keys: ["R"] },
      { label: "Search the List", keys: ["/"] },
      { label: "Close", keys: ["Esc"] },
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
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md">
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
      </DialogContent>
    </Dialog>
  );
}
