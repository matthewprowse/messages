"use client";

// Small bits of list state shared by the Inbox and Summary lists: which row is swiped open, and today's date.

import { useCallback, useEffect, useState } from "react";

/** Which row is swiped open on a touch screen: one at a time, closed by touching another row. */
export function useSwipedRow() {
  const [swiped, setSwiped] = useState<string | null>(null);
  const onSwipe = useCallback((id: string | null) => setSwiped(id), []);
  const onTouchRow = useCallback((id: string) => setSwiped((s) => (s === id ? s : null)), []);
  return { swiped, onSwipe, onTouchRow };
}

/** Today's date, changing at midnight, so memoised rows redraw their times ("Yesterday") as days pass. */
export function useToday() {
  const [today, setToday] = useState(() => new Date().toDateString());
  useEffect(() => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
    const t = setTimeout(() => setToday(new Date().toDateString()), midnight + 1000);
    return () => clearTimeout(t);
  }, [today]);
  return today;
}
