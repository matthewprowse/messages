"use client";

// Runs the search index for the signed-in user: opens it with their key once the app is unlocked, keeps it in step with
// the conversations, contacts and tasks the app already holds, pages through the rest of the history in the background
// (feed.ts). Mounted once, by the search palette, which loads when the page is idle. The wipe on sign-out is not here:
// AuthProvider (lib/auth.tsx) runs it from app start, so it also happens when the palette never loaded.

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth";
import { useApp } from "../store";
import { userKeys } from "../vault";
import { flushIndex, openIndex, removeDocs, upsertDocs } from "./client";
import { contactDoc, taskDoc, threadDoc, type People } from "./docs";
import { countMessages, indexEvents, indexMessages, indexNotes, indexTasks, rememberProgress, watchChanges, type FeedContext } from "./feed";
import { NEW_SAVED, type Saved } from "./paging";
import { bumpRev, setProgress } from "./status";
import { planSync } from "./sync-plan";
import type { Doc } from "./types";

/** A tab that was hidden this long (ms) catches up on messages when it comes back, in case Realtime missed some. */
const CATCH_UP_AFTER_MS = 2 * 60_000;

function savedOf(meta: unknown): Saved {
  const m = (meta as { messages?: Saved } | null)?.messages;
  return m && typeof m.done === "boolean" ? { cursor: m.cursor ?? null, done: m.done } : NEW_SAVED;
}

export function useSearchIndexer() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { threads, contacts, tasks, contactById, threadById } = useApp();
  const [opened, setOpened] = useState(false);

  // The latest lookups, for loaders that run for minutes and must not hold a stale list.
  const latest = useRef({ contactById, threadById });
  latest.current = { contactById, threadById };
  const people = useMemo<People>(() => ({
    nameOf: (id) => latest.current.contactById(id)?.name,
    peersOf: (threadId) => {
      const t = latest.current.threadById(threadId);
      return t ? t.participantIds.map((id) => latest.current.contactById(id)?.name).filter(Boolean).join(" ") : "";
    },
  }), []);

  const sent = useRef({ thread: new Map<string, string>(), contact: new Map<string, string>(), task: new Map<string, string>() });

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let busy = false;
    let lastRun = 0;
    let saved = NEW_SAVED;
    const ctx: FeedContext = { people, cancelled: () => cancelled };
    sent.current = { thread: new Map(), contact: new Map(), task: new Map() };
    let stopWatching: () => void = () => {};

    async function history() {
      if (busy) return;
      busy = true;
      try {
        setProgress({ building: true });
        await indexMessages(ctx, userId!, saved, (s) => { saved = s; void rememberProgress(s).catch(() => undefined); });
      } finally {
        busy = false;
        lastRun = Date.now();
        if (!cancelled) setProgress({ building: false });
      }
    }

    // Quietly: a failed read leaves the index as it was and the next session or return to the tab tries again.
    const safely = (work: () => Promise<void>) => work().catch(() => undefined);

    (async () => {
      const keys = await userKeys();
      if (cancelled) return;
      const init = await openIndex(keys, userId);
      if (cancelled) return;
      saved = savedOf(init.meta);
      setProgress({ ready: true, indexed: init.counts.messages, building: !saved.done });
      bumpRev();
      setOpened(true);
      stopWatching = watchChanges(userId, ctx);
      // Small things first, so notes, events and tasks are findable within seconds; then the long walk back through the mail.
      await safely(() => indexTasks(ctx));
      await safely(() => indexEvents(ctx));
      await safely(() => indexNotes(ctx));
      const total = await countMessages(userId).catch(() => null);
      if (!cancelled) setProgress({ total });
      await safely(history);
    })().catch(() => { if (!cancelled) setProgress({ building: false }); });

    const onVisible = () => {
      if (document.visibilityState === "hidden") { void flushIndex().catch(() => undefined); return; }
      if (!busy && lastRun && Date.now() - lastRun > CATCH_UP_AFTER_MS) void safely(history);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", onVisible);

    return () => {
      cancelled = true;
      stopWatching();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onVisible);
      setOpened(false);
      // Not closed here: a remount (React strict mode, a route change) opens it again, and opening replaces the old one.
      void flushIndex().catch(() => undefined);
    };
  }, [userId, people]);

  // Conversations, contacts and tasks the app holds go in as they change; only differences are sent.
  useEffect(() => {
    if (!opened) return;
    const upserts: Doc[] = [];
    const removed: string[] = [];
    const batches: ["thread" | "contact" | "task", Doc[]][] = [
      ["thread", threads.map((t) => threadDoc(t, contactById))],
      ["contact", contacts.map(contactDoc)],
      ["task", tasks.map(taskDoc)],
    ];
    for (const [kind, docs] of batches) {
      const plan = planSync(sent.current[kind], docs);
      sent.current[kind] = plan.state;
      upserts.push(...plan.upserts);
      removed.push(...plan.removed);
    }
    if (upserts.length === 0 && removed.length === 0) return;
    void (async () => {
      if (upserts.length) await upsertDocs(upserts);
      if (removed.length) await removeDocs(removed);
      bumpRev();
    })().catch(() => undefined);
  }, [opened, threads, contacts, tasks, contactById]);
}
