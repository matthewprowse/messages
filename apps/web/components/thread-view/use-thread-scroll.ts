// Scrolling for an open conversation: stay at the bottom as messages arrive, offer a New Messages jump when you are
// reading higher up, and load earlier messages near the top without moving what you are reading.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DraftPhase } from "@/lib/store";
import type { Message } from "@/lib/types";
import { isNearBottom } from "@/components/near-bottom";

/** The element that actually scrolls inside a shadcn ScrollArea. */
export function viewportOf(root: HTMLElement | null) {
  return root?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]") ?? null;
}

interface ScrollArgs {
  threadId: string;
  threadExists: boolean;
  msgs: Message[];
  loaded: boolean;
  phase?: DraftPhase;
  hasOlder: (threadId: string) => boolean;
  loadOlderMessages: (threadId: string) => Promise<boolean>;
}

/** Owns the scroll ref and all scroll behaviour of the message list. */
export function useThreadScroll({ threadId, threadExists, msgs, loaded, phase, hasOlder, loadOlderMessages }: ScrollArgs) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // New messages at the bottom scroll into view when you are already near the bottom (or sent them
  // yourself); otherwise a New Messages button offers the jump. Older ones loaded at the top do not scroll.
  const lastId = msgs[msgs.length - 1]?.id;
  const lastMine = msgs[msgs.length - 1]?.from === "me";
  const nearBottom = useRef(true);
  const seenLast = useRef<{ threadId: string; id: string | undefined } | null>(null);
  const [newBelow, setNewBelow] = useState(false);
  const scrollToBottom = useCallback((smooth = false) => {
    const el = viewportOf(scrollRef.current);
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    setNewBelow(false);
  }, []);
  useEffect(() => {
    const el = viewportOf(scrollRef.current);
    if (!el) return;
    function onScroll() {
      if (!el) return;
      const near = isNearBottom(el);
      nearBottom.current = near;
      if (near) setNewBelow(false);
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [threadId, threadExists]);
  useEffect(() => { nearBottom.current = true; setNewBelow(false); }, [threadId]);
  useEffect(() => {
    const prev = seenLast.current;
    seenLast.current = { threadId, id: lastId };
    // Opening a conversation, or its first messages arriving, goes to the bottom.
    const opening = !prev || prev.threadId !== threadId || prev.id === undefined;
    if (opening || nearBottom.current || lastMine) scrollToBottom();
    else if (prev.id !== lastId) setNewBelow(true);
  }, [threadId, lastId, lastMine, scrollToBottom]);
  // A reply being drafted grows the list at the bottom: follow it only when already there.
  useEffect(() => { if (phase && nearBottom.current) scrollToBottom(); }, [phase, scrollToBottom]);

  // Scrolling near the top loads the page before, and keeps the message that was first in view where it
  // was. Measured from that message, so it holds whether or not the browser's own scroll anchoring acts.
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const firstId = msgs[0]?.id;
  const firstIdNow = useRef(firstId);
  firstIdNow.current = firstId;
  const [loadingOlder, setLoadingOlder] = useState(false);
  useLayoutEffect(() => {
    const el = viewportOf(scrollRef.current);
    const a = anchor.current;
    const node = a && el?.querySelector(`[data-message-id="${CSS.escape(a.id)}"]`);
    if (el && a && node) el.scrollTop += node.getBoundingClientRect().top - a.top;
    anchor.current = null;
  }, [firstId]);
  useEffect(() => {
    const el = viewportOf(scrollRef.current);
    if (!el || !loaded) return;
    function onScroll() {
      const first = el?.querySelector("[data-message-id]");
      if (!el || !first || el.scrollTop > 400 || anchor.current || !hasOlder(threadId)) return;
      const startId = firstIdNow.current;
      anchor.current = { id: first.getAttribute("data-message-id")!, top: first.getBoundingClientRect().top };
      setLoadingOlder(true);
      loadOlderMessages(threadId)
        .then((added) => { if (!added) anchor.current = null; })
        .catch(() => { anchor.current = null; })
        .finally(() => {
          setLoadingOlder(false);
          // The layout effect clears the anchor when the first message changed; if nothing was prepended it never runs and
          // the stale anchor would stop older pages loading. Checked after the commit so a real prepend is not cut short.
          requestAnimationFrame(() => { if (firstIdNow.current === startId) anchor.current = null; });
        });
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      anchor.current = null;
      setLoadingOlder(false);
    };
  }, [threadId, loaded, threadExists, loadOlderMessages, hasOlder]);
  return { scrollRef, newBelow, scrollToBottom, loadingOlder };
}
