"use client";

// Swipe right to left on a list row to slide its actions out, as on Inbox rows: one row open at a time, a touch on
// another row closes it, and the tap that ends a swipe never opens the row. Used by the Notes list. The Inbox and
// Summary rows (thread-list/thread-row.tsx) still carry their own copy of this gesture and could adopt it.

import { useCallback, useRef, useState } from "react";

/** How far a finger moves sideways, and more sideways than down, before it counts as a swipe (px). */
export const SWIPE_PX = 32;
/** How long after a swipe a click is still taken as its end, not a tap (ms). */
const SWIPE_CLICK_MS = 400;

/** Which row of a list is swiped open: one at a time. Pass `open` and the two callbacks down to each row. */
export function useSwipeOpen() {
  const [openId, setOpenId] = useState<string | null>(null);
  const onSwipe = useCallback((id: string | null) => setOpenId(id), []);
  // A finger on another row closes the open one; on the open row itself it stays, so its buttons can be tapped.
  const onTouchRow = useCallback((id: string) => setOpenId((s) => (s === id ? s : null)), []);
  return { openId, onSwipe, onTouchRow };
}

/**
 * The touch handlers for one row, and a click guard for the row's link. A sideways move clearly more sideways than
 * down opens (to the left) or closes (to the right) the row, so scrolling the list is never a swipe. The row element
 * needs `touch-pan-y` so the browser leaves sideways moves to it.
 */
export function useRowSwipe({ id, open, onSwipe, onTouchRow, disabled = false }: {
  id: string;
  open: boolean;
  /** Opens this row (its id) or closes it (null). */
  onSwipe: (id: string | null) => void;
  onTouchRow: (id: string) => void;
  disabled?: boolean;
}) {
  const touch = useRef<{ x: number; y: number; done: boolean } | null>(null);
  const swipedAt = useRef(0);
  const handlers = {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      touch.current = { x: t.clientX, y: t.clientY, done: false };
      onTouchRow(id);
    },
    onTouchMove: (e: React.TouchEvent) => {
      const start = touch.current;
      if (!start || start.done || disabled) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(t.clientY - start.y) * 1.5) return;
      start.done = true;
      swipedAt.current = Date.now();
      onSwipe(dx < 0 ? id : null);
    },
    onTouchEnd: () => { touch.current = null; },
  };
  /** Call first in the link's onClick: true when the click was the end of a swipe or closed the open row, and was cancelled. */
  const guardClick = (e: React.MouseEvent) => {
    if (Date.now() - swipedAt.current < SWIPE_CLICK_MS) { e.preventDefault(); return true; }
    if (open) { e.preventDefault(); onSwipe(null); return true; }
    return false;
  };
  return { handlers, guardClick };
}
