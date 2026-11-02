"use client";

// The line under a reply waiting for a time chosen with Send Later: when it goes, and Edit, Send Now and Cancel.
// Edit takes the message back into the reply box; the others act on the outbox row while the worker has not taken it.

import { useState } from "react";
import { useApp } from "@/lib/store";
import { describeWhen } from "@/lib/send-schedule";
import type { Message } from "@/lib/types";
import { Button } from "@/components/ui/button";

export function ScheduledLine({ m }: { m: Message }) {
  const { cancelScheduled, sendScheduledNow } = useApp();
  const [working, setWorking] = useState(false);
  const outboxId = m.id.replace(/^outbox:/, "");
  const run = async (act: () => Promise<boolean>) => {
    setWorking(true);
    try { await act(); } finally { setWorking(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-1 px-3 text-xs text-muted-foreground">
      <span>Scheduled for {describeWhen(new Date(m.scheduledFor ?? Date.now()), new Date())}</span>
      <Button variant="ghost" size="xs" disabled={working} onClick={() => run(() => cancelScheduled(outboxId, true))}>Edit</Button>
      <Button variant="ghost" size="xs" disabled={working} onClick={() => run(() => sendScheduledNow(outboxId))}>Send Now</Button>
      <Button variant="ghost" size="xs" disabled={working} onClick={() => run(() => cancelScheduled(outboxId, false))}>Cancel</Button>
    </div>
  );
}
