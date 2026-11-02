"use client";

// The week and day views: days across, hours down the side, with drag or double-click to make a new event.


import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CalendarEvent } from "@/lib/calendar";
import { dayKey, fromKey, pad } from "@/lib/dates";
import { type DayTask } from "@/lib/tasks";
import { cn } from "@/lib/utils";

import { HOUR, LABELS, MAX_COLUMNS, MAX_COLUMNS_WIDE, chipRange } from "./dates";
import { TaskSlot, hourLabel, isSlot, layoutDay, taskSlot } from "./day-layout";
import { EventChip } from "./event-details";
import { MoreEvents } from "./more-events";
import { TaskChip } from "./task-parts";

export const SNAP = 15; // minutes a dragged-out new event snaps to

/** The new event being dragged out, with the times it will have. */
export function DragPreview({ from, to, offset }: { from: number; to: number; offset: number }) {
  const start = Math.min(from, to);
  const end = Math.min(Math.max(from, to, start + SNAP), 1440 - SNAP);
  return (
    <div
      className="pointer-events-none absolute inset-x-0.5 z-10 flex flex-col rounded-md border border-primary bg-primary/15 px-1.5 py-1 text-xs"
      style={{ top: (start / 60) * HOUR - offset + 1, height: ((end - start) / 60) * HOUR - 2 }}
    >
      <span className="truncate tabular-nums">{minutesLabel(start)} to {minutesLabel(end)}</span>
    </div>
  );
}

/** "HH:MM" for minutes from midnight. */
export function minutesLabel(m: number) {
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/**
 * The days across with the hours down the side, like Apple Calendar's week. As many days as fit: seven on a wide
 * screen, fewer on a phone. Below md the page scrolls (the day names stick to the top) and the hours before the
 * first event are left out; from md up the hours scroll inside the pane.
 */
export function WeekView({
  days,
  byDay,
  tasksByDay: dayTasks,
  today,
  now,
  selectedKey,
  inline,
  onSelectDay,
  onCreateAt,
}: {
  days: string[];
  byDay: Map<string, CalendarEvent[]>;
  tasksByDay: Map<string, DayTask[]>;
  today: Date;
  now: Date;
  selectedKey: string;
  inline: boolean;
  onSelectDay: (key: string) => void;
  /** A new event on that day from `time`, an hour long or to `until`. */
  onCreateAt: (key: string, time: string, until?: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // A new event being dragged out in a day: the minutes it was started at and has reached.
  const [drag, setDrag] = useState<{ key: string; from: number; to: number } | null>(null);
  const pointerType = useRef("");
  const todayKey = dayKey(today);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const allDay = days.map((key) => (byDay.get(key) ?? []).filter((e) => e.allDay));
  const allDayTasks = days.map((key) => (dayTasks.get(key) ?? []).filter((t) => !t.timed));
  const hasAllDay = allDay.some((list) => list.length > 0) || allDayTasks.some((list) => list.length > 0);
  const nowHour = now.getHours();

  // Opens an hour before now in today's week, else at 08:00, or earlier when an event this week starts earlier.
  const firstHour = useMemo(() => {
    const earliest = Math.min(
      24,
      ...days.flatMap((key) => (byDay.get(key) ?? []).filter((e) => !e.allDay && dayKey(new Date(e.startsAt)) === key).map((e) => new Date(e.startsAt).getHours())),
      ...days.flatMap((key) => (dayTasks.get(key) ?? []).filter((t) => t.timed && t.task.dueAt).map((t) => new Date(t.task.dueAt!).getHours())),
    );
    return Math.max(0, Math.min(earliest, days.includes(todayKey) ? Math.max(0, nowHour - 1) : 8, 23));
  }, [days, byDay, dayTasks, todayKey, nowHour]);
  // Where the drawing starts: the top of the day, or in the page-scrolling layout the first hour shown.
  const offset = inline ? firstHour * HOUR : 0;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    // A little higher than the hour, so its label is not cut off under the day names.
    if (el && !inline) el.scrollTop = Math.max(0, firstHour * HOUR - 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days[0], inline]);

  const hours = Array.from({ length: 23 - firstHour * Number(inline) }, (_, i) => i + 1 + firstHour * Number(inline));
  /** Minutes from midnight at the pointer, in the day column the event belongs to. */
  const minuteAt = (e: React.MouseEvent<HTMLElement>) => {
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top + offset;
    return Math.max(0, Math.min(1440 - SNAP, (y / HOUR) * 60));
  };

  return (
    <div className="flex flex-col md:h-full">
      <div className="sticky top-0 z-20 shrink-0 bg-background md:static">
        <div className="flex border-b md:overflow-y-hidden md:[scrollbar-gutter:stable]">
          <div className="shrink-0" style={{ width: LABELS }} />
          {days.map((key) => {
            const d = fromKey(key);
            const isToday = key === todayKey;
            const isSelected = key === selectedKey;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelectDay(key)}
                aria-pressed={isSelected}
                aria-label={d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
                className={cn(
                  "flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 py-2 text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset md:min-h-0",
                  isSelected && "bg-muted hover:bg-muted",
                )}
              >
                <span className="text-muted-foreground">{d.toLocaleDateString("en-GB", { weekday: "short" })}</span>
                <span className={cn("flex size-7 items-center justify-center rounded-full tabular-nums", isToday && "bg-primary font-medium text-primary-foreground")}>{d.getDate()}</span>
              </button>
            );
          })}
        </div>
        {hasAllDay && (
          <div className="flex border-b md:overflow-y-hidden md:[scrollbar-gutter:stable]">
            <div className="shrink-0 py-1.5 pr-2 text-right text-xs text-muted-foreground" style={{ width: LABELS }}>All Day</div>
            {days.map((key, i) => (
              <div key={key} className="flex min-w-0 flex-1 flex-col gap-1 border-l p-1">
                {allDay[i].map((e) => (
                  <EventChip key={e.id} event={e} day={key} className="truncate px-1.5 py-0.5 font-medium">{e.title}</EventChip>
                ))}
                {allDayTasks[i].map((t) => <TaskChip key={t.task.id} item={t} className="py-0.5" />)}
              </div>
            ))}
          </div>
        )}
      </div>
      <div ref={scrollRef} className="md:min-h-0 md:flex-1 md:overflow-y-auto md:[scrollbar-gutter:stable]">
        <div className="relative flex" style={{ height: 24 * HOUR - offset }}>
          {/* A line across every day at each hour. */}
          {hours.map((h) => (
            <div key={h} className="pointer-events-none absolute right-0 border-t" style={{ top: h * HOUR - offset, left: LABELS }} />
          ))}
          <div className="sticky left-0 z-10 shrink-0 bg-background" style={{ width: LABELS }}>
            {inline && firstHour > 0 && (
              <span className="absolute top-0.5 right-2 text-xs tabular-nums text-muted-foreground">{hourLabel(firstHour)}</span>
            )}
            {hours.map((h) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 text-xs tabular-nums text-muted-foreground" style={{ top: h * HOUR - offset }}>
                {hourLabel(h)}
              </span>
            ))}
          </div>
          {days.map((key) => {
            const timed: (CalendarEvent | TaskSlot)[] = [
              ...(byDay.get(key) ?? []).filter((e) => !e.allDay),
              ...(dayTasks.get(key) ?? []).filter((t) => t.timed && t.task.dueAt).map(taskSlot),
            ];
            // One day has the whole width, so it fits more side by side than a week of narrow columns.
            const { items, more } = layoutDay(key, timed, inline ? firstHour * 60 : 0, days.length === 1 ? MAX_COLUMNS_WIDE : MAX_COLUMNS);
            return (
              <div
                key={key}
                className="relative min-w-0 flex-1 border-l select-none"
                // In the empty part of a day: drag out a new event, or double-click to start one at
                // that half hour. A tap on a touch screen starts one at that hour, as a drag there scrolls.
                onPointerDown={(e) => {
                  pointerType.current = e.pointerType;
                  if (e.button !== 0 || e.target !== e.currentTarget || e.pointerType === "touch") return;
                  const m = Math.floor(minuteAt(e) / SNAP) * SNAP;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDrag({ key, from: m, to: m });
                }}
                onPointerMove={(e) => {
                  if (!drag || drag.key !== key) return;
                  const m = Math.round(minuteAt(e) / SNAP) * SNAP;
                  setDrag((d) => (d && d.key === key && d.to !== m ? { ...d, to: m } : d));
                }}
                onPointerUp={() => {
                  if (!drag || drag.key !== key) return;
                  const [a, b] = [Math.min(drag.from, drag.to), Math.max(drag.from, drag.to)];
                  setDrag(null);
                  if (b - a >= SNAP) onCreateAt(key, minutesLabel(a), minutesLabel(Math.min(b, 1440 - SNAP)));
                }}
                onPointerCancel={() => setDrag(null)}
                onDoubleClick={(e) => {
                  if (e.target === e.currentTarget) onCreateAt(key, minutesLabel(Math.floor(minuteAt(e) / 30) * 30));
                }}
                onClick={(e) => {
                  if (pointerType.current !== "touch" || e.target !== e.currentTarget) return;
                  onCreateAt(key, hourLabel(Math.floor(minuteAt(e) / 60)));
                }}
              >
                {drag?.key === key && <DragPreview from={drag.from} to={drag.to} offset={offset} />}
                {items.map(({ event, top, bottom, col, cols }) => {
                  const height = ((bottom - top) / 60) * HOUR;
                  const place = { top: (top / 60) * HOUR - offset + 1, height: height - 2, left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)` };
                  if (isSlot(event)) return <TaskChip key={event.id} item={event.item} className="absolute ring-1 ring-background" style={place} />;
                  return (
                    <EventChip
                      key={event.id}
                      event={event}
                      day={key}
                      className="absolute flex flex-col px-1.5 py-1 ring-1 ring-background"
                      style={place}
                    >
                      <span className={cn("font-medium break-words", height < 40 ? "truncate" : "line-clamp-2")}>{event.title}</span>
                      {height >= 40 && <span className="truncate tabular-nums text-muted-foreground">{event.pending ? "Saving" : chipRange(event)}</span>}
                    </EventChip>
                  );
                })}
                {more.map((m) => (
                  <MoreEvents key={m.top} day={key} count={m.count} items={m.events} style={{ top: (m.top / 60) * HOUR - offset + 1 }} />
                ))}
                {key === todayKey && nowMinutes >= (inline ? firstHour * 60 : 0) && (
                  <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: (nowMinutes / 60) * HOUR - offset }}>
                    <span className="-ml-1 size-2 rounded-full bg-destructive" />
                    <span className="h-px flex-1 bg-destructive" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

