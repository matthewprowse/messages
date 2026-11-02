"use client";

// The Inbox keyboard: J and K (or [ and ]) step through conversations, Enter opens the first, E archives, # deletes,
// ! moves to Junk, U toggles unread, / searches, Escape closes. Keys typed in a field, menu or dialog are left alone.
// Mounted by ThreadList, which stays mounted beside the open conversation, so the keys work with one open.

import { useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { shortcutAction } from "@/lib/selection";
import { stepTarget, withQuery } from "@/lib/thread-list";
import { isTypingKey } from "@/components/new-menu";
import type { RowAction } from "./use-row-actions";

interface Keys {
  /** The rows top to bottom, as the list shows them. */
  order: string[];
  query: string;
  picked: string[];
  setChecked: (ids: string[]) => void;
  run: (ids: string[], action: RowAction) => void;
}

/** The row under keyboard focus, when focus is on one. */
function focusedRow(): string | null {
  return (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-thread-row]")?.dataset.threadRow ?? null;
}

export function useInboxKeys(keys: Keys) {
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  // The handler reads the latest through a ref, so the listener is added once.
  const latest = useRef({ keys, openId: params.id ?? null, router });
  latest.current = { keys, openId: params.id ?? null, router };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTypingKey(e)) return;
      const { keys: { order, query, picked, setChecked, run }, openId, router } = latest.current;
      const open = (id: string) => {
        // The first open from the list adds a history entry; stepping on from there replaces it, so Back returns to the list.
        const href = withQuery(`/inbox/${id}`, query);
        if (openId) router.replace(href); else router.push(href);
        document.querySelector(`[data-thread-row="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
      };
      const step = e.key === "j" || e.key === "]" ? 1 : e.key === "k" || e.key === "[" ? -1 : 0;
      if (step && !e.shiftKey) {
        const to = stepTarget(order, openId ?? focusedRow(), step);
        if (to && to !== openId) { e.preventDefault(); open(to); }
        return;
      }
      if (e.key === "Enter" && !openId && !focusedRow() && document.activeElement === document.body) {
        if (order[0]) { e.preventDefault(); open(order[0]); }
        return;
      }
      if (e.key === "Escape") {
        if (picked.length) { setChecked([]); return; }
        if (openId) { (document.activeElement as HTMLElement | null)?.blur?.(); router.push(withQuery("/inbox", query)); }
        return;
      }
      if (e.key === "/" && !e.repeat) {
        const box = document.querySelector<HTMLInputElement>("input[placeholder='Search Conversations']");
        if (box) { e.preventDefault(); box.focus(); }
        return;
      }
      if (e.repeat) return;
      // The checked rows, else the open conversation, else the row with focus.
      const row = focusedRow();
      const target = picked.length ? picked : openId ? [openId] : row ? [row] : [];
      if (target.length === 0) return;
      const action: RowAction | null = e.key === "u" || e.key === "U" ? "read" : shortcutAction(e);
      if (!action) return;
      e.preventDefault();
      run(target, action);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
