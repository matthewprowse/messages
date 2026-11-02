// Keyboard input for the Calendar page: T, A, D, W and the arrows change the day and the view, N starts a new event
// and Shift+N a new task. There is no wheel or swipe navigation on purpose: an afternoon read with a trackpad must not
// jump to the next day, so moving through time is the arrows, the keys and the buttons.

import { useEffect } from "react";
import { addDays } from "@/lib/dates";
import type { View } from "@/components/calendar/dates";

/** Keys that would be typed into something are left alone. */
function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || !!target.closest('input, textarea, select, [role="tablist"], [role="listbox"], [role="menu"], [role="slider"], [role="dialog"], [role="alertdialog"]');
}

/** T is today, the arrows move a day, A, D and W switch the view, N and Shift+N start something new. `blocked` is true while a dialog is open. */
export function useCalendarKeys({ today, blocked, setAnchor, setView, onNewEvent, onNewTask }: {
  today: Date;
  blocked: boolean;
  setAnchor: (next: Date | ((d: Date) => Date)) => void;
  setView: (view: View) => void;
  onNewEvent: () => void;
  onNewTask: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTyping(e.target) || blocked) return;
      const key = e.key.toLowerCase();
      if (key === "t") setAnchor(today);
      else if (key === "a") setView("agenda");
      else if (key === "d") setView("day");
      else if (key === "w") setView("week");
      else if (key === "n") (e.shiftKey ? onNewTask : onNewEvent)();
      else if (e.key === "ArrowLeft") setAnchor((d) => addDays(d, -1));
      else if (e.key === "ArrowRight") setAnchor((d) => addDays(d, 1));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [today, blocked, onNewEvent, onNewTask]);
}
