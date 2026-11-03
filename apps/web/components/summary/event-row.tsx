"use client";

// A calendar event on the Summary page, laid out like a conversation row. It opens the Calendar.

import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { dayKey, eventDetail, type CalendarEvent } from "@/lib/calendar";
import { timeOf } from "@/lib/format";
import { PrepMark } from "@/components/prep/prep-mark";

// Laid out like a conversation row: an avatar-sized icon, a title line and a detail line. Events are not
// tied to a conversation, so the row opens the Calendar.
export function EventRow({ event, today }: { event: CalendarEvent; today: string }) {
  // A timed event that began before today is already under way.
  const when = event.allDay ? "All Day" : dayKey(new Date(event.startsAt)) < today ? "Ongoing" : timeOf(event.startsAt);
  return (
    <Link
      href={`/calendar?date=${today}&event=${encodeURIComponent(event.id)}`}
      data-row-link
      data-event-row
      className="flex scroll-mt-[calc(var(--summary-header)+var(--summary-band))] items-center gap-3 rounded-lg p-3 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
        <CalendarDays className="size-4" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex h-5 items-center justify-between gap-3">
          <span className="min-w-0 truncate text-sm font-medium">{event.title}</span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{when}</span>
        </div>
        <div className="flex h-4 items-center">
          <span className="min-w-0 truncate text-xs">{eventDetail(event)}</span>
          <PrepMark eventId={event.id} startsAt={event.startsAt} allDay={event.allDay} />
        </div>
      </div>
    </Link>
  );
}
