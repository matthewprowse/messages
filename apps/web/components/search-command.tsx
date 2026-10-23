"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import type { Contact, Thread } from "@/lib/types";
import { relTime } from "@/lib/format";
import { providerLabel } from "@/components/primitives";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
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

// Search lives in a command palette rather than its own page. It opens from the rail or with ⌘K / Ctrl+K.
export function SearchCommand({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
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

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Search conversations, contacts and messages." className="sm:max-w-xl">
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

  const results = useMemo(() => {
    const words = term.toLowerCase().split(/\s+/).filter(Boolean);
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
  }, [term, recent, live, contacts, texts, contactOf]);

  function go(href: string) {
    onPick();
    router.push(href);
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
      <CommandList className="max-h-80">
        <CommandEmpty>No Results Found</CommandEmpty>
        {results.contacts.length > 0 && (
          <CommandGroup heading="Contacts">
            {results.contacts.map((c) => (
              <CommandItem key={c.id} value={`contact-${c.id}`} className={ITEM} onSelect={() => go(contactHref(c))}>
                <Row title={c.name} detail={[c.emails[0] ?? (c.phones[0] && formatPhone(c.phones[0])), c.company].filter(Boolean).join(" · ")} />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {results.conversations.length > 0 && (
          <CommandGroup heading={term.trim() ? "Conversations" : "Recent"}>
            {results.conversations.map((t) => (
              // Same second line as the conversation's row: the subject of an email, the latest message of a chat.
              <CommandItem key={t.id} value={`thread-${t.id}`} className={ITEM} onSelect={() => go(`/inbox/${t.id}`)}>
                <Row title={titleOf(t, contactOf)} detail={t.channel === "email" ? t.subject : t.preview} meta={relTime(t.lastMessageAt)} />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {results.messages.length > 0 && (
          <CommandGroup heading="Messages">
            {results.messages.map(({ m, thread: t, snippet: text }) => {
              const sender = m.from === "me" ? "You" : t.isGroup ? contactOf(m.from)?.name.split(" ")[0] : undefined;
              return (
                <CommandItem key={m.id} value={`message-${m.id}`} className={ITEM} onSelect={() => go(`/inbox/${t.id}?message=${m.id}`)}>
                  <Row title={titleOf(t, contactOf)} detail={sender ? `${sender}: ${text}` : text} meta={relTime(m.sentAt)} />
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}
