"use client";

// The phone's agenda header: one week as seven days across, like This Week on the Summary, in place of the month grid
// that does not fit a phone. A dot for each of a day's first three items; tapping a day takes the list to it.

import type { CalendarEvent } from "@/lib/calendar";
import { dayKey, fromKey } from "@/lib/dates";
import type { DayTask } from "@/lib/tasks";
import { cn } from "@/lib/utils";

const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short" });

/** `days` are the week's seven keys; the page owns the events, tasks and selected day. */
export function WeekStrip({ days, byDay, tasksByDay, today, selectedKey, onSelect }: {
  days: string[];
  byDay: Map<string, CalendarEvent[]>;
  tasksByDay: Map<string, DayTask[]>;
  today: Date;
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  const todayKey = dayKey(today);
  return (
    <div className="grid grid-cols-7 gap-1 px-1 pb-1">
      {days.map((key) => {
        const d = fromKey(key);
        const total = (byDay.get(key)?.length ?? 0) + (tasksByDay.get(key)?.length ?? 0);
        const date = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(key)}
            aria-pressed={key === selectedKey}
            aria-label={total ? `${date}, ${total} ${total === 1 ? "item" : "items"}` : date}
            className={cn("flex min-w-0 flex-col items-center gap-0.5 rounded-lg py-1.5 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50", key === selectedKey && "bg-muted hover:bg-muted")}
          >
            <span className="text-xs text-muted-foreground">{WEEKDAY.format(d)}</span>
            <span className={cn("flex size-7 items-center justify-center rounded-full text-sm font-medium tabular-nums", key === todayKey && "bg-primary text-primary-foreground")}>{d.getDate()}</span>
            <span className="flex h-1.5 gap-0.5">
              {Array.from({ length: Math.min(3, total) }, (_, n) => <span key={n} className="size-1.5 rounded-full bg-foreground/60" />)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
