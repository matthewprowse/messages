"use client";

// Keeps the notes list in step with other tabs and devices, and gets unsaved text out before the page goes.
// Refresh triggers: the tab coming back into view, the device coming back online, and Realtime changes to the
// notes table (needs the table in the supabase_realtime publication; without it the focus refresh still works).
// Leaving: text is sent with a keepalive request when the tab is hidden or the page is going, and the "leave this
// page?" prompt appears only when text could really be lost (see NoteSaver.unsaved).

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import type { NoteSaver } from "@/lib/note-saver";

/** A refresh from focus is skipped when the list was loaded this recently (ms). */
const FOCUS_REFRESH_MS = 20_000;
/** Realtime changes are gathered this long (ms) before the list is read again, so our own save's reply lands first. */
const REALTIME_SETTLE_MS = 600;

export function useNotesSync({ userId, saver, refresh, has }: {
  userId: string | null;
  saver: NoteSaver;
  /** Reads the list again, keeping notes being edited. */
  refresh: () => void;
  /** Whether a note is in the list on screen. */
  has: (id: string) => boolean;
}) {
  useEffect(() => {
    let last = Date.now();
    const reload = () => { last = Date.now(); refresh(); };
    const onVisible = () => {
      if (document.visibilityState === "hidden") { saver.flushAll(true); return; }
      saver.retryNow();
      if (Date.now() - last > FOCUS_REFRESH_MS) reload();
    };
    const onOnline = () => { saver.retryNow(); reload(); };
    const onHide = () => saver.flushAll(true);
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // Starting the saves first reads the editor's text, so the check sees the real length.
      saver.flushAll(true);
      if (saver.unsaved) e.preventDefault();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      saver.flushAll(true);
    };
  }, [saver, refresh]);

  useEffect(() => {
    if (!userId) return;
    const changed = new Map<string, string | null>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      timer = undefined;
      // Our own saves come back as changes at a version we already hold; only other versions are worth reading.
      const foreign = [...changed].some(([id, at]) => at === null || saver.version(id) !== at);
      changed.clear();
      if (foreign) refresh();
    };
    const note = (id: string | undefined, at: string | null) => {
      if (!id) return;
      changed.set(id, at);
      timer ??= setTimeout(settle, REALTIME_SETTLE_MS);
    };
    const channel = supabase
      .channel(`notes-${userId}`)
      // Deletions cannot be filtered by user, so only ids held here are acted on.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "notes" }, (payload) => {
        const id = (payload.old as { id?: string } | null)?.id;
        if (id && has(id)) note(id, null);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "notes", filter: `user_id=eq.${userId}` }, (payload) => {
        if (payload.eventType === "DELETE") return;
        const row = payload.new as { id?: string; updated_at?: string };
        note(row.id, row.updated_at ?? null);
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [userId, saver, refresh, has]);
}
