"use client";

// The calendar page's month grid: each day a white card on the grey, the selected one grey. It only draws the days it is
// given; the page owns the events, tasks and selected date.

import { Circle, CircleCheck } from "lucide-react";
import type { CalendarEvent } from "@/lib/calendar";
import { dayKey, fromKey } from "@/lib/dates";
import { longDate } from "./dates";
import { timeOf } from "@/lib/format";
import { type DayTask } from "@/lib/tasks";
import { cn } from "@/lib/utils";

/** The month as a grid of dates. The selected date's events are in the list beside it. */
export function MonthView({
  days,
  byDay,
  tasksByDay: dayTasks,
  today,
  selected,
  monthOf,
  onSelect,
  onCreate,
}: {
  days: string[];
  byDay: Map<string, CalendarEvent[]>;
  tasksByDay: Map<string, DayTask[]>;
  today: Date;
  selected: Date;
  /** Whose month the grid shows, which follows the agenda list as it scrolls. */
  monthOf: Date;
  onSelect: (d: Date) => void;
  /** A new event on that day, from a double-click on it. */
  onCreate: (key: string) => void;
}) {
  const todayKey = dayKey(today);
  const selectedKey = dayKey(selected);
  const month = monthOf.getMonth();
  const weekdays = days.slice(0, 7).map((key) => fromKey(key).toLocaleDateString("en-GB", { weekday: "short" }));

  // On a phone the grid stays on screen above the list, so its rows are as short as a date and its dots allow.
  return (
    <div className="flex flex-col md:h-full">
      <div className="grid shrink-0 grid-cols-7 gap-1">
        {weekdays.map((w) => <span key={w} className="px-2 pb-1 text-right text-xs text-muted-foreground">{w}</span>)}
      </div>
      {/* A container query, not the screen width: the grid is narrower beside the list, and titles fit once a cell does. */}
      <div className="@container grid grid-cols-7 grid-rows-6 gap-1 md:min-h-0 md:flex-1">
        {days.map((key) => {
          const d = fromKey(key);
          const events = byDay.get(key) ?? [];
          const tasks = dayTasks.get(key) ?? [];
          const isToday = key === todayKey;
          const isSelected = key === selectedKey;
          const outside = d.getMonth() !== month;
          const shown = events.slice(0, 3);
          const shownTasks = tasks.slice(0, Math.max(0, 3 - shown.length));
          const total = events.length + tasks.length;
          const date = longDate(d);
          const counted = [
            events.length && `${events.length} ${events.length === 1 ? "event" : "events"}`,
            tasks.length && `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`,
          ].filter(Boolean).join(", ");
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(d)}
              onDoubleClick={() => onCreate(key)}
              aria-label={counted ? `${date}, ${counted}` : date}
              aria-pressed={isSelected}
              className={cn(
                "flex h-10 min-h-0 min-w-0 flex-col gap-0.5 overflow-hidden rounded-lg border bg-background px-1 py-0.5 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 md:h-auto md:p-1",
                outside && "bg-background/60",
                isSelected && "bg-muted hover:bg-muted",
              )}
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center self-end rounded-full text-sm tabular-nums",
                  outside && "text-muted-foreground",
                  isToday && "bg-primary font-medium text-primary-foreground",
                )}
              >
                {d.getDate()}
              </span>
              {/* Titles when the grid is wide enough, otherwise one dot for each of the first three items. */}
              {total > 0 && (
                <span className="mx-auto flex shrink-0 gap-0.5 @2xl:hidden">
                  {Array.from({ length: Math.min(3, total) }, (_, n) => <span key={n} className="size-1.5 rounded-full bg-foreground/60" />)}
                </span>
              )}
              <span className="hidden min-w-0 flex-col gap-0.5 @2xl:flex">
                {shown.map((e) => (
                  <span key={e.id} className={cn("flex min-w-0 items-center gap-1 rounded-sm px-1 text-xs", e.allDay && "bg-secondary", outside && "text-muted-foreground")}>
                    <span className="min-w-0 flex-1 truncate">{e.title}</span>
                    {!e.allDay && <span className="shrink-0 tabular-nums text-muted-foreground">{timeOf(e.startsAt)}</span>}
                  </span>
                ))}
                {shownTasks.map(({ task, overdue }) => {
                  const Icon = task.completed ? CircleCheck : Circle;
                  return (
                    <span key={task.id} className={cn("flex min-w-0 items-center gap-1 px-1 text-xs", outside && "text-muted-foreground", overdue && "text-destructive")}>
                      <Icon className="size-3 shrink-0" />
                      <span className={cn("min-w-0 flex-1 truncate", task.completed && "line-through")}>{task.title}</span>
                    </span>
                  );
                })}
                {total > shown.length + shownTasks.length && <span className="px-1 text-xs text-muted-foreground">{total - shown.length - shownTasks.length} more</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

