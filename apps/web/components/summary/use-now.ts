"use client";

// A clock that moves on every `everyMs`, for views whose time windows only matter at that grain. The Summary's
// sections use a coarse one so a quiet minute does not re-derive them; the events list uses a fine one.

import { useEffect, useState } from "react";

/** The current time, replaced every `everyMs`. */
export function useNow(everyMs: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
