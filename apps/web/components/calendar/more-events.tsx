"use client";

// The "+N" button in a crowded day column of the week and day views: it lists the events and tasks that did not fit
// beside the others, so the fourth meeting at the same time can still be opened from the grid.

import { useContext, useState } from "react";
import { type CalendarEvent } from "@/lib/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { chipRange } from "./dates";
import { type TaskSlot, isSlot } from "./day-layout";
import { Page } from "./page-context";
import { TaskChip } from "./task-parts";

export function MoreEvents({ day, count, items, style }: { day: string; count: number; items: (CalendarEvent | TaskSlot)[]; style: React.CSSProperties }) {
  const { setOpenKey } = useContext(Page);
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          style={style}
          aria-label={`${count} more at this time`}
          className="absolute right-0.5 z-10 rounded-sm bg-background/90 px-1 text-xs tabular-nums text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          +{count}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-64 flex-col gap-1 p-1">
        {items.map((item) =>
          isSlot(item) ? (
            <TaskChip key={item.id} item={item.item} className="py-1" />
          ) : (
            <button
              key={item.id}
              type="button"
              onClick={() => { setOpen(false); setOpenKey(`${item.id}|${day}`); }}
              className="flex min-w-0 flex-col rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
            >
              <span className="truncate font-medium">{item.title}</span>
              <span className="truncate text-xs tabular-nums text-muted-foreground">{item.pending ? "Saving" : item.allDay ? "All Day" : chipRange(item)}</span>
            </button>
          ),
        )}
      </PopoverContent>
    </Popover>
  );
}
