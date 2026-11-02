"use client";

// Triage flow: when the open conversation is dealt with (archived, deleted, junked, answered), open the next row of the
// Summary instead of leaving an empty pane, so E can be pressed down the list.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { ListFilter } from "@/lib/types";
import { listHref, nextAfterDone } from "@/lib/summary-list";

/** Phones show the list or the conversation, never both, so there going back to the list is the right landing. */
const WIDE = "(min-width: 768px)";

/**
 * `order` is the rows top to bottom, `openId` the conversation open beside them and `done` whether it no longer needs
 * you. It remembers the list from when the open one was still in it, so the row after it can be found once it is gone.
 * Only a conversation seen in the list is replaced: one opened by link that was never there is left alone.
 */
export function useAdvanceAfterDone(order: string[], openId: string | undefined, done: boolean, filter: ListFilter) {
  const router = useRouter();
  const before = useRef<{ id: string; order: string[] } | null>(null);
  useEffect(() => {
    if (!openId) return;
    if (!done) {
      if (order.includes(openId)) before.current = { id: openId, order };
      return;
    }
    const seen = before.current;
    if (!seen || seen.id !== openId) return;
    before.current = null;
    if (!window.matchMedia(WIDE).matches) return;
    // Replace, not push: the finished conversation's page is not somewhere Back should return to.
    router.replace(listHref(filter, nextAfterDone(seen.order, order, openId)), { scroll: false });
  }, [order, openId, done, filter, router]);
}
