// Carries out a row action (archive, delete, junk, read, pin) on one conversation or a selection, through the store.

import { useCallback, useRef } from "react";
import { useApp } from "@/lib/store";
import type { ShortcutAction } from "@/lib/selection";

export type RowAction = ShortcutAction | "read" | "pin";

/** Carries out a row action on one conversation or a selection. */
export function useRowActions() {
  const { threads: all, archive, unarchive, trash, setJunk, markRead, pin } = useApp();
  // Reads the latest threads and store actions through a ref, so the callback is stable and does not rebuild every row's handlers.
  const latest = useRef({ all, archive, unarchive, trash, setJunk, markRead, pin });
  latest.current = { all, archive, unarchive, trash, setJunk, markRead, pin };
  return useCallback((ids: string[], action: RowAction) => {
    const { all, archive, unarchive, trash, setJunk, markRead, pin } = latest.current;
    const wanted = new Set(ids);
    const threads = all.filter((t) => wanted.has(t.id));
    if (threads.length === 0) return;
    const found = threads.map((t) => t.id);
    // Archive toggles like Junk: archived conversations come back to the inbox.
    if (action === "archive") { if (threads.every((t) => t.status === "archived")) unarchive(found); else archive(found); }
    else if (action === "trash") trash(found);
    // Junk toggles: conversations that are all junk come out of it, anything else goes in.
    else if (action === "junk") setJunk(found, !threads.every((t) => t.junk));
    else if (action === "read") {
      // Marks them read if any is unread, otherwise unread.
      const read = threads.some((t) => t.unread);
      for (const t of threads) if (t.unread === read) markRead(t.id, read);
    } else {
      const pinned = !threads.every((t) => t.pinned);
      for (const t of threads) if (t.pinned !== pinned) pin(t.id, pinned);
    }
  }, []);
}
