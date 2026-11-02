// The AI's summary of the open conversation, under the header: two lines, with More to read the rest. Quiet on purpose,
// it is the triage the Inbox list does not have room to show.

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Shorter than this fits the two lines, so there is nothing to expand. */
const LONG_SUMMARY = 160;

export function SummaryStrip({ summary }: { summary: string }) {
  const [open, setOpen] = useState(false);
  const text = summary.trim();
  if (!text) return null;
  return (
    <div className="shrink-0 border-b bg-muted/30 px-3 py-2 md:px-4" data-summary-strip>
      <div className="mx-auto flex w-full max-w-2xl items-start gap-2 text-xs text-muted-foreground">
        <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <p className={cn("min-w-0 flex-1 leading-5", !open && "line-clamp-2")}>{text}</p>
        {text.length > LONG_SUMMARY && (
          <Button type="button" variant="ghost" size="xs" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "Less" : "More"}</Button>
        )}
      </div>
    </div>
  );
}
