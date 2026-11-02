"use client";

// The "Prep" word on a Summary event row when a brief is ready for it. The row already opens the event, where the
// brief is shown, so this is a marker inside that link rather than a second link (links cannot nest).

import { useEffect, useState } from "react";
import { loadPreppedEvents } from "@/lib/prep";

const SOON_MS = 3 * 3_600_000; // briefs are built 30 minutes ahead, so only events close by can have one

export function PrepMark({ eventId, startsAt, allDay }: { eventId: string; startsAt: string; allDay: boolean }) {
  const [ready, setReady] = useState(false);
  const soon = !allDay && Date.parse(startsAt) - Date.now() < SOON_MS && Date.parse(startsAt) > Date.now() - SOON_MS;
  useEffect(() => {
    if (!soon) return;
    let live = true;
    loadPreppedEvents([eventId]).then((s) => { if (live) setReady(s.has(eventId)); }, () => undefined);
    return () => { live = false; };
  }, [eventId, soon]);
  if (!ready) return null;
  return <span className="ml-2 text-xs font-medium underline underline-offset-2">Prep</span>;
}
