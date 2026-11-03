// The AI's summary of the open conversation: one quiet line in a small card just above the reply card, the width of the
// message column, with More to read the rest. It is the triage the Conversations list does not have room to show.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Shorter than this fits the line, so there is nothing to expand. */
const LONG_SUMMARY = 90;

export function SummaryStrip({ summary }: { summary: string }) {
  const [open, setOpen] = useState(false);
  const text = summary.trim();
  if (!text) return null;
  return (
    <div className="shrink-0 px-3 md:px-4" data-summary-strip>
      <div className="mx-auto flex w-full max-w-2xl items-start gap-2 rounded-lg border bg-background py-1 pr-1 pl-3 text-xs text-muted-foreground shadow-xs">
        <p className={cn("min-w-0 flex-1 py-0.5 leading-5", !open && "line-clamp-1")}>{text}</p>
        {text.length > LONG_SUMMARY && (
          <Button type="button" variant="ghost" size="xs" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "Less" : "More"}</Button>
        )}
      </div>
    </div>
  );
}
