"use client";

// The top of the calendar's grid card: the dates on show with Previous, Today and Next in a 40px row, and under it the
// one-line notes for a refresh that failed or days the worker has not read.

import { ArrowLeft, ArrowRight } from "lucide-react";
import type { SyncNotice } from "@/lib/sync-window";
import { Button } from "@/components/ui/button";
import { IconAction, Tip } from "@/components/tip";

/** `unit` names what the arrows move by ("Week", "Month") for their tooltips. */
export function GridBar({ label, unit, onMove, onToday }: { label: string; unit: string; onMove: (n: number) => void; onToday: () => void }) {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between gap-2 pr-1 pl-3">
      <h2 className="min-w-0 truncate text-sm font-medium tabular-nums">{label}</h2>
      <div className="flex shrink-0 items-center gap-1">
        <IconAction label={`Previous ${unit}`} icon={ArrowLeft} onClick={() => onMove(-1)} />
        <Tip label="Go to Today"><Button variant="ghost" onClick={onToday}>Today</Button></Tip>
        <IconAction label={`Next ${unit}`} icon={ArrowRight} onClick={() => onMove(1)} />
      </div>
    </div>
  );
}

/** One quiet line for each: the failed refresh with Try Again, then how far the calendars are read. */
export function GridNotes({ refreshFailed, notice, onRetry }: { refreshFailed: boolean; notice: SyncNotice; onRetry: () => void }) {
  if (!refreshFailed && !notice) return null;
  return (
    <div className="flex shrink-0 flex-col border-t text-sm text-muted-foreground">
      {refreshFailed && (
        <div className="flex h-10 items-center justify-between gap-3 pr-1 pl-3">
          <span className="min-w-0 truncate">Events did not refresh.</span>
          <Button variant="ghost" onClick={onRetry}>Try Again</Button>
        </div>
      )}
      {notice && (
        <p className="flex min-h-10 items-center px-3 py-2">
          {notice.kind === "past" ? "Events from before the last three months are not synced." : "Calendars are synced up to a year ahead."}
        </p>
      )}
    </div>
  );
}
