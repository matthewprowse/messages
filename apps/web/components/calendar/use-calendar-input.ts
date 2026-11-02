// Keyboard and wheel input for the Calendar page: scrolling moves through time, and T, A, D, W and the arrows
// change the day and the view. Both listeners live here so the page only says what moving means.

import { useEffect, useRef } from "react";
import { addDays, type View } from "@/components/calendar/dates";

/** Keys that would be typed into something are left alone. */
function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || !!target.closest('input, textarea, select, [role="tablist"], [role="listbox"], [role="menu"], [role="slider"], [role="dialog"], [role="alertdialog"]');
}

/**
 * Scrolling moves through time: down past the end of a day for the next one, sideways across a week for the next.
 * Scrolling inside a view that still has room to scroll is left alone. In the agenda the wheel over the month grid
 * scrolls the list instead.
 */
export function useWheelNavigation(paneRef: React.RefObject<HTMLDivElement | null>, view: View, move: (n: number) => void) {
  const moveRef = useRef(move);
  moveRef.current = move;
  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    if (view === "agenda") {
      // Scrolling the month grid scrolls the agenda list, and the grid follows it.
      const forward = (e: WheelEvent) => {
        const list = document.querySelector<HTMLElement>('[data-calendar-list] [data-slot="scroll-area-viewport"]');
        if (list && list.scrollHeight > list.clientHeight) list.scrollTop += e.deltaY;
      };
      el.addEventListener("wheel", forward, { passive: true });
      return () => el.removeEventListener("wheel", forward);
    }
    let travelled = 0;
    let lastAt = 0;
    let cooldown = 0;
    const onWheel = (e: WheelEvent) => {
      const stamp = performance.now();
      if (stamp < cooldown) return;
      if (stamp - lastAt > 300) travelled = 0;
      lastAt = stamp;
      let delta = 0;
      if (view === "week") {
        // Mostly sideways: a trackpad swipe, or the wheel with Shift held.
        delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
      } else {
        let node = e.target as HTMLElement | null;
        let room = false;
        while (node && node !== el) {
          if (node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY)) {
            const atEdge = e.deltaY > 0 ? node.scrollTop + node.clientHeight >= node.scrollHeight - 1 : node.scrollTop <= 0;
            if (!atEdge) room = true;
            break;
          }
          node = node.parentElement;
        }
        delta = room || Math.abs(e.deltaX) > Math.abs(e.deltaY) ? 0 : e.deltaY;
      }
      if (!delta) { travelled = 0; return; }
      travelled += delta;
      if (Math.abs(travelled) < 160) return;
      moveRef.current(travelled > 0 ? 1 : -1);
      travelled = 0;
      cooldown = stamp + 700;
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, [view]);
}

/** T is today, the arrows move a day, A, D and W switch the view. `blocked` is true while a dialog is open. */
export function useCalendarKeys({ today, blocked, setAnchor, setView }: { today: Date; blocked: boolean; setAnchor: (next: Date | ((d: Date) => Date)) => void; setView: (view: View) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTyping(e.target) || blocked) return;
      const key = e.key.toLowerCase();
      if (key === "t") setAnchor(today);
      else if (key === "a") setView("agenda");
      else if (key === "d") setView("day");
      else if (key === "w") setView("week");
      else if (e.key === "ArrowLeft") setAnchor((d) => addDays(d, -1));
      else if (e.key === "ArrowRight") setAnchor((d) => addDays(d, 1));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [today, blocked]);
}
