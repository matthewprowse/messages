"use client";

// Promises in the open conversation, under its summary: what you and they have promised and are yet to do, each with
// Done and Snooze. Draws nothing when there are none.

import { useMemo } from "react";
import { ListChecks } from "lucide-react";
import { promisesFor } from "@/lib/commitments";
import { useCommitments } from "./use-commitments";
import { PromiseRow } from "./promise-row";

export function CommitmentsStrip({ threadId, theirName }: { threadId: string; theirName: string }) {
  const { all, done, snooze } = useCommitments();
  const list = useMemo(() => promisesFor(all, threadId), [all, threadId]);
  if (list.length === 0) return null;
  const now = new Date();
  return (
    <div className="shrink-0 border-b bg-muted/30 px-3 py-2 md:px-4" data-commitments-strip>
      <div className="mx-auto w-full max-w-2xl">
        <p className="flex items-center gap-2 px-3 text-xs font-medium text-muted-foreground"><ListChecks className="size-3.5" aria-hidden />Promises</p>
        {list.map((c) => <PromiseRow key={c.id} promise={c} who={c.owner === "me" ? "You" : theirName} now={now} onDone={done} onSnooze={snooze} />)}
      </div>
    </div>
  );
}
