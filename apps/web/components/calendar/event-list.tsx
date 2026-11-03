"use client";

// The agenda list of events and tasks, grouped by day.


import { useContext, useEffect, useRef } from "react";
import { dayKey, eventDetail, type CalendarEvent } from "@/lib/calendar";
import { allDayPosition } from "@/lib/calendar-days";
import { timeOf } from "@/lib/format";
import { type DayTask } from "@/lib/tasks";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Row, Separated } from "@/components/surface";

import { dayTitle, isDimmed } from "./dates";
import { EventLead } from "./event-lead";
import { Now, Page } from "./page-context";
import { dayRows } from "./day-rows";
import { TaskRow } from "./task-parts";

// Laid out like a conversation row: the 40px circle with the calendar's logo, a title line and a detail line. Clicking
// one shows everything about the event, including who is invited.
export function EventRow({ event, day }: { event: CalendarEvent; day: string }) {
  const { setOpenKey, providerOf } = useContext(Page);
  const now = useContext(Now);
  // A timed event that began on an earlier day is already under way; a multi-day all-day event says which day it is on.
  const when = event.pending ? "Saving" : event.allDay ? (allDayPosition(event, day) ?? "All Day") : dayKey(new Date(event.startsAt)) < day ? "Ongoing" : timeOf(event.startsAt);
  const faded = event.pending || isDimmed(event, now);
  return (
    <Row
      lead={<EventLead provider={providerOf(event.accountId)} />}
      title={event.title}
      detail={eventDetail(event)}
      meta={when}
      onClick={() => setOpenKey(`${event.id}|${day}`)}
      className={faded ? "opacity-60" : undefined}
    />
  );
}

// A band like the Summary's: padded, separated below, and stuck to the top while its day scrolls.
export function DaySection({ day, title, count, children }: { day: string; title: string; count: number; children: React.ReactNode }) {
  return (
    <section data-day={day} className="not-first:pt-3 last:pb-3" aria-label={title}>
      <h2 className="sticky top-0 z-[5] -mx-3 flex items-center gap-2 border-b bg-background p-3 text-sm font-medium">
        <span className="flex h-8 items-center gap-2">
          {title}
          <Badge variant="secondary">{count}</Badge>
        </span>
      </h2>
      {count > 0 && <div className="pt-3">{children}</div>}
    </section>
  );
}

/** The days' events as rows, a section for each day. In the month view the list follows the date picked in the grid. */
export function EventList({
  keys,
  byDay,
  tasksByDay: dayTasks,
  today,
  selectedKey,
  loading,
  empty,
  onEnd,
  loadingMore,
  onVisible,
}: {
  keys: string[];
  byDay: Map<string, CalendarEvent[]>;
  tasksByDay: Map<string, DayTask[]>;
  today: Date;
  selectedKey?: string;
  loading: boolean;
  empty: React.ReactNode;
  /** Called when the end of the list scrolls into view, to load the next month. */
  onEnd?: () => void;
  loadingMore?: boolean;
  /** Called with the day at the top of the list as it is scrolled. */
  onVisible?: (key: string) => void;
}) {
  const rowsRef = useRef<HTMLDivElement>(null);
  const shownKey = useRef<string | undefined>(undefined);
  const endRef = useRef<HTMLDivElement>(null);

  // The list scrolls inside its own pane, except in the phone's day and week views where it scrolls with the page;
  // watching the end against the screen works for both.
  useEffect(() => {
    const el = endRef.current;
    if (!el || !onEnd || loading) return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) onEnd(); }, { rootMargin: "400px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [onEnd, loading]);

  // Scrolling the list reports which day is at its top, so the month above and the grid follow it.
  useEffect(() => {
    const viewport = rowsRef.current?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!viewport || !onVisible || loading) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = viewport.getBoundingClientRect().top + 60;
        const sections = rowsRef.current?.querySelectorAll<HTMLElement>("[data-day]") ?? [];
        for (const s of sections) {
          if (s.getBoundingClientRect().bottom > top) { onVisible(s.dataset.day!); return; }
        }
      });
    };
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => { cancelAnimationFrame(frame); viewport.removeEventListener("scroll", onScroll); };
  }, [onVisible, loading]);

  useEffect(() => {
    // Runs again once the events load, so the list opens on the selected day.
    if (loading) return;
    const content = rowsRef.current;
    const viewport = content?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
    const section = selectedKey ? content?.querySelector<HTMLElement>(`[data-day="${selectedKey}"]`) : null;
    const picked = shownKey.current !== undefined && shownKey.current !== selectedKey;
    shownKey.current = selectedKey;
    if (!section) return;
    if (viewport && viewport.scrollHeight > viewport.clientHeight) {
      viewport.scrollTo({ top: section.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop, behavior: "smooth" });
    } else if (picked) {
      // In the phone's day and week views the page scrolls rather than the list, so the day is brought up the page.
      // Only when a date is tapped, not when the page opens.
      section.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [selectedKey, loading]);

  return (
    // The scrollbar starts below the first day's header and its line (57px), and stays above the headers that
    // stick to the top as their days scroll, rather than running behind them.
    <ScrollArea className="h-full" scrollbarClassName="z-10 !top-[57px] !h-auto">
      <div ref={rowsRef} className="px-3">
        {loading && (
          <div className="flex flex-col gap-2 py-3" aria-label="Loading events">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 p-3">
                <Skeleton className="size-10 shrink-0 rounded-full" />
                <div className="flex flex-1 flex-col gap-1">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-4 w-5/6" />
                </div>
              </div>
            ))}
          </div>
        )}
        {!loading && (empty ?? keys.map((key) => {
          const rows = dayRows(byDay.get(key) ?? [], dayTasks.get(key) ?? []);
          return (
            <DaySection key={key} day={key} title={dayTitle(key, today)} count={rows.length}>
              {/* The selected day keeps its band with a 0 when it is empty, so the list can still open on it. */}
              <Separated>
                {rows.map((row) => row.event ? <EventRow key={row.id} event={row.event} day={key} /> : <TaskRow key={row.id} item={row.task!} />)}
              </Separated>
            </DaySection>
          );
        }))}
        {!loading && loadingMore && (
          <div className="flex flex-col gap-2 py-3" aria-label="Loading the next month">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
        <div ref={endRef} aria-hidden className="h-px" />
      </div>
    </ScrollArea>
  );
}

