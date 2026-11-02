"use client";

// One list of the Attachments library (a tab, visible or hidden files) loaded a page at a time. It keeps the last list in
// memory per tab so coming back shows files at once and refreshes underneath, loads further pages on request, and quietly
// refreshes its top when a file arrives (Realtime) or the tab comes back to the front. The maths is in attachment-pages.ts.

import { useCallback, useEffect, useRef, useState } from "react";
import { countAttachments, loadAttachmentPage, type HiddenMode } from "./data";
import { supabase } from "./supabase";
import { mergePages, refreshHead, type Cursor } from "./attachment-pages";
import type { Kind } from "./attachment-filters";
import type { FiledAttachment } from "./types";

type Snapshot = { files: FiledAttachment[]; next: Cursor | null; total: number | null };
// Kept for the session only: names are decrypted here, so nothing is written to disk.
const remembered = new Map<string, Snapshot>();

const REFRESH_DELAY_MS = 1500; // a sync inserts files in bursts; one refresh covers them
const STALE_MS = 30 * 1000; // coming back to the tab refreshes if the list is older than this

export type AttachmentList = {
  /** Null until the first load, false if it failed. */
  files: FiledAttachment[] | null | false;
  /** True while more pages remain on the server. */
  more: boolean;
  /** The server's count for this tab; for a list that is not enabled, just the count. */
  total: number | null;
  /** True while a page or a refresh is on its way. */
  loading: boolean;
  loadMore: () => void;
  retry: () => void;
  /** Takes files out of this list (hidden or unhidden elsewhere) and adjusts the count. */
  remove: (ids: string[]) => void;
  /** Puts files into this list in order and adjusts the count. */
  insert: (files: FiledAttachment[]) => void;
};

/**
 * With `enabled` the list loads and stays fresh. Without it the list only counts, which is all a collapsed "N Hidden Files"
 * row needs.
 */
export function useAttachmentPages(kind: Kind, mode: HiddenMode, enabled = true): AttachmentList {
  const key = `${kind}:${mode}`;
  const [snap, setSnap] = useState<Snapshot | null | false>(() => remembered.get(key) ?? null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef<Snapshot | null>(null);
  const busy = useRef(false);
  const loadedAt = useRef(0);
  latest.current = snap || null;

  const store = useCallback((next: Snapshot) => { remembered.set(key, next); latest.current = next; setSnap(next); }, [key]);

  // The first page, shown from memory when this tab was open before, then refreshed underneath it.
  useEffect(() => {
    let cancelled = false;
    setSnap(remembered.get(key) ?? null);
    setLoading(true);
    if (!enabled) {
      countAttachments(kind, mode).then((total) => { if (!cancelled) { setSnap((s) => (s ? { ...s, total } : { files: [], next: null, total })); setLoading(false); } }, () => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }
    busy.current = true;
    loadAttachmentPage(kind, mode).then(
      (page) => {
        if (cancelled) return;
        busy.current = false;
        loadedAt.current = Date.now();
        const before = remembered.get(key);
        // A list already in memory keeps the older pages the person scrolled to; its top is replaced.
        const files = before && before.files.length ? refreshHead(before.files, page.files) : page.files;
        const next = before && before.files.length && page.next && before.next ? before.next : page.next;
        store({ files, next, total: page.total ?? before?.total ?? null });
        setLoading(false);
      },
      (err) => {
        console.error(err instanceof Error ? err.message : "Load attachments failed");
        if (cancelled) return;
        busy.current = false;
        if (!remembered.get(key)) setSnap(false);
        setLoading(false);
      },
    );
    return () => { cancelled = true; busy.current = false; };
  }, [key, kind, mode, enabled, attempt, store]);

  const loadMore = useCallback(() => {
    const cur = latest.current;
    if (!enabled || !cur?.next || busy.current) return;
    busy.current = true;
    setLoading(true);
    loadAttachmentPage(kind, mode, cur.next).then(
      (page) => {
        busy.current = false;
        const base = remembered.get(key) ?? cur;
        store({ files: mergePages(base.files, page.files), next: page.next, total: base.total });
        setLoading(false);
      },
      (err) => { console.error(err instanceof Error ? err.message : "Load more attachments failed"); busy.current = false; setLoading(false); },
    );
  }, [enabled, kind, mode, key, store]);

  // Refreshes the top of the list without disturbing the pages below it.
  const refresh = useCallback(() => {
    if (!enabled || busy.current || !latest.current) return;
    busy.current = true;
    loadAttachmentPage(kind, mode).then(
      (page) => {
        busy.current = false;
        loadedAt.current = Date.now();
        const base = remembered.get(key) ?? latest.current;
        if (base) store({ files: refreshHead(base.files, page.files), next: base.next ?? page.next, total: page.total ?? base.total });
      },
      () => { busy.current = false; },
    );
  }, [enabled, kind, mode, key, store]);

  // A file that arrives while the page is open: Realtime says something changed, the top is fetched again after a short wait.
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(timer); timer = setTimeout(refresh, REFRESH_DELAY_MS); };
    const channel = supabase.channel(`attachments-${key}`).on("postgres_changes", { event: "*", schema: "public", table: "attachments" }, soon).subscribe();
    // Realtime may not be on for the table yet, and a laptop wakes after a sleep: the tab coming forward refreshes too.
    const onVisible = () => { if (document.visibilityState === "visible" && Date.now() - loadedAt.current > STALE_MS) refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); void supabase.removeChannel(channel); };
  }, [enabled, key, refresh]);

  const remove = useCallback((ids: string[]) => {
    const cur = latest.current;
    if (!cur) return;
    const gone = new Set(ids);
    const files = cur.files.filter((a) => !gone.has(a.id));
    store({ ...cur, files, total: cur.total === null ? null : Math.max(0, cur.total - (cur.files.length - files.length)) });
  }, [store]);

  const insert = useCallback((added: FiledAttachment[]) => {
    const cur = latest.current ?? { files: [], next: null, total: null };
    const files = mergePages(cur.files, added);
    store({ ...cur, files, total: cur.total === null ? null : cur.total + (files.length - cur.files.length) });
  }, [store]);

  return {
    files: snap === false ? false : snap && (enabled || snap.files.length) ? snap.files : enabled ? null : [],
    more: !!(snap && snap.next),
    total: snap ? snap.total : null,
    loading,
    loadMore,
    retry: () => setAttempt((n) => n + 1),
    remove,
    insert,
  };
}
