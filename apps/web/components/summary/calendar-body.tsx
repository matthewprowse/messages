"use client";

// The inside of the Summary page's "Today's Calendar" section: a retry row when the load failed, a skeleton while it
// loads, otherwise the events.

import { CalendarX } from "lucide-react";
import type { CalendarEvent } from "@/lib/calendar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EventRow } from "./event-row";
import { Separated } from "./section";

export function CalendarBody({ failed, pending, events, today, onRetry }: { failed: boolean; pending: boolean; events: CalendarEvent[]; today: string; onRetry: () => void }) {
  if (failed) {
    return (
      <div className="flex items-center gap-3 p-3" role="alert">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
          <CalendarX className="size-4" />
        </div>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">Couldn&apos;t Load Calendar</span>
        <Button variant="secondary" onClick={onRetry}>Retry</Button>
      </div>
    );
  }
  if (pending) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading calendar" className="flex items-center gap-3 p-3">
        <Skeleton className="size-10 shrink-0 rounded-full" />
        <div className="flex flex-1 flex-col gap-1">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    );
  }
  return <Separated>{events.map((e) => <EventRow key={e.id} event={e} today={today} />)}</Separated>;
}
