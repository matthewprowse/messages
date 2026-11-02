"use client";

// Gathers a contact's timeline: messages a page at a time, and the smaller sources (promises, leads, notes, meetings, tasks,
// documents) once. Everything is mapped to TimelineItems and merged newest first. Nothing here marks a conversation read.
// Give it a key of the contact's id so a different contact starts fresh.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ContactDetail } from "@/lib/contacts";
import { useApp } from "@/lib/store";
import { useMeetings } from "@/components/meetings-data";
import { useDocumentCards } from "@/components/attachments/document-store";
import { loadLinkedNotes } from "@/lib/note-links";
import { mergeNewestFirst, visibleWindow } from "@/lib/timeline/build";
import { documentItem, meetingItem, noteItem, taskItem } from "@/lib/timeline/items";
import { loadLeadItems, loadMessagePage, loadPromiseItems } from "@/lib/timeline/load";
import type { TimelineItem } from "@/lib/timeline/types";

const DOCUMENT_FILES = 150; // newest files asked for a document card: the card is read per file, so the ask is bounded

/** A source that failed to load is left out rather than breaking the page; this lists them for a quiet note. */
export function useTimeline(contact: ContactDetail) {
  const { tasks } = useApp();
  // One-to-one conversations only, as in the person view: a group chat is not a conversation with them.
  const channels = useMemo(() => new Map(contact.conversations.filter((c) => !c.isGroup).map((c) => [c.id, c.channel as string])), [contact.conversations]);
  const threadIds = useMemo(() => [...channels.keys()], [channels]);

  const [messages, setMessages] = useState<TimelineItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [messagesDone, setMessagesDone] = useState(threadIds.length === 0);
  const [paging, setPaging] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);

  const more = useCallback(async () => {
    if (busy.current || messagesDone) return;
    busy.current = true;
    setPaging(true);
    try {
      const page = await loadMessagePage(channels, cursor);
      setMessages((all) => {
        const seen = new Set(all.map((i) => i.key));
        return [...all, ...page.items.filter((i) => !seen.has(i.key))];
      });
      setCursor(page.next);
      setMessagesDone(page.next === null);
    } catch {
      setFailed(true);
      setMessagesDone(true);
    } finally {
      busy.current = false;
      setPaging(false);
    }
  }, [channels, cursor, messagesDone]);

  // The first page loads on its own; later ones when the person asks.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || threadIds.length === 0) return;
    started.current = true;
    void more();
  }, [more, threadIds.length]);

  // The smaller sources: each fails alone.
  const [extras, setExtras] = useState<{ promises: TimelineItem[]; leads: TimelineItem[]; notes: TimelineItem[] }>({ promises: [], leads: [], notes: [] });
  const [extrasReady, setExtrasReady] = useState(false);
  useEffect(() => {
    let live = true;
    const now = new Date();
    Promise.allSettled([loadPromiseItems(threadIds, now), loadLeadItems(contact.id), loadLinkedNotes({ kind: "contact", id: contact.id })]).then(([p, l, n]) => {
      if (!live) return;
      if ([p, l, n].some((r) => r.status === "rejected")) setFailed(true);
      setExtras({
        promises: p.status === "fulfilled" ? p.value : [],
        leads: l.status === "fulfilled" ? l.value : [],
        notes: n.status === "fulfilled" ? n.value.map(noteItem) : [],
      });
      setExtrasReady(true);
    });
    return () => { live = false; };
  }, [contact.id, threadIds]);

  const { meetings } = useMeetings(useMemo(() => ({ contactIds: [contact.id] }), [contact.id]));
  const meetingItems = useMemo(() => meetings.map(meetingItem), [meetings]);
  const taskItems = useMemo(() => tasks.filter((t) => t.contactId === contact.id).flatMap((t) => taskItem(t) ?? []), [tasks, contact.id]);

  const files = useMemo(() => contact.attachments.filter((a) => a.kind === "pdf" || a.kind === "image").slice(0, DOCUMENT_FILES), [contact.attachments]);
  const cardOf = useDocumentCards(useMemo(() => files.map((f) => f.id), [files]));
  const documentItems = files.flatMap((f) => {
    const entry = cardOf(f.id);
    return entry?.state === "card" ? [documentItem({ id: f.id, name: f.name, sentAt: f.sentAt, threadId: f.threadId }, entry.card)] : [];
  });

  const all = useMemo(
    () => mergeNewestFirst([messages, extras.promises, extras.leads, extras.notes, meetingItems, taskItems, documentItems]),
    // documentItems is rebuilt each render; its content only changes with the cards, which re-render through cardOf.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, extras, meetingItems, taskItems, documentItems.map((d) => d.key).join(",")],
  );
  const items = useMemo(() => visibleWindow(all, messagesDone), [all, messagesDone]);

  return { items, all, more, paging, messagesDone, ready: extrasReady && (messages.length > 0 || messagesDone), failed };
}
