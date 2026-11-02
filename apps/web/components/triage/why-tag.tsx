"use client";

// The Urgent or Needs Reply tag on a list row, with the AI's reason on hover or tap and a Not Right? choice. The reason is
// only read once the card opens, and the card (which needs the store) only mounts then, so a long list stays cheap.

import { useState } from "react";
import type { Thread } from "@/lib/types";
import { notRightOptions, whyText } from "@/lib/triage-why";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useNotRight } from "./use-not-right";
import { useTriageNote } from "./use-triage-note";

function WhyCard({ thread, onDone }: { thread: Thread; onDone: () => void }) {
  const note = useTriageNote(thread.id, thread.lastMessageAt);
  const notRight = useNotRight();
  const text = whyText(note?.code, note?.words);
  const options = notRightOptions(thread);
  return (
    <div className="space-y-2">
      <p className="text-sm">{text ?? (note ? "The AI did not say why." : "Loading")}</p>
      {options.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-muted-foreground">Not Right?</span>
          {options.map((o) => <Button key={o.value} type="button" size="xs" variant="secondary" onClick={() => { notRight(thread.id, o.value); onDone(); }}>{o.label}</Button>)}
        </div>
      )}
    </div>
  );
}

/** The row tag. A click or tap opens the reason instead of the conversation. */
export function WhyTag({ thread, marker }: { thread: Thread; marker: "urgent" | "needs_reply" }) {
  const [open, setOpen] = useState(false);
  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={300}>
      <HoverCardTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          aria-label={`${marker === "urgent" ? "Urgent" : "Needs Reply"}: why?`}
          className="shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); } }}
        >
          <Badge variant={marker === "urgent" ? "destructive" : "secondary"}>{marker === "urgent" ? "Urgent" : "Needs Reply"}</Badge>
        </span>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-64">{open && <WhyCard thread={thread} onDone={() => setOpen(false)} />}</HoverCardContent>
    </HoverCard>
  );
}
