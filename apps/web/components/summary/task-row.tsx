"use client";

// A task due today (or overdue) on the Summary page, with its checkbox. It opens the task in Calendar.

import Link from "next/link";
import { useApp } from "@/lib/store";
import { timeOf } from "@/lib/format";
import { taskDetail, taskWhen, type DayTask } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";

// Laid out like an event row, with the task's checkbox where the icon goes. Ticking it shows at once; the row
// opens the task in Calendar.
export function TaskRow({ item, today, source }: { item: DayTask; today: string; source: string | undefined }) {
  const { tickTask } = useApp();
  const { task, overdue } = item;
  return (
    <div className={cn("flex items-center gap-3 rounded-lg p-3 hover:bg-muted/50", task.pending && "opacity-60")}>
      {/* The whole 32px box is the target, not just the 16px checkbox, for a thumb. */}
      <label className="flex size-10 shrink-0 cursor-pointer items-center justify-center">
        <Checkbox checked={task.completed} onCheckedChange={(checked) => tickTask(task, checked === true, "summary")} aria-label={task.title} />
      </label>
      <Link
        href={`/calendar?date=${today}&task=${encodeURIComponent(task.id)}`}
        data-row-link
        data-event-row
        className="flex min-w-0 flex-1 scroll-mt-[calc(var(--summary-header)+var(--summary-band))] flex-col gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <div className="flex h-5 items-center justify-between gap-3">
          <span className={cn("min-w-0 truncate text-sm font-medium", task.completed && "line-through")}>{task.title}</span>
          <span className={cn("shrink-0 text-xs tabular-nums text-muted-foreground", overdue && !task.pending && "text-destructive")}>{taskWhen(item, timeOf)}</span>
        </div>
        <div className="flex h-4 items-center">
          <span className="min-w-0 truncate text-xs">{taskDetail(task, source)}</span>
        </div>
      </Link>
    </div>
  );
}
