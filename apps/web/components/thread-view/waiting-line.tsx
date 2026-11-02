"use client";

// The line under a WhatsApp message a send limit is holding back: why it waits, when it goes, and Cancel. It is not a failure. The worker
// sends it by itself once the account is under its limit again (apps/worker/src/whatsapp/send-limits.ts).

import { useState } from "react";
import { useApp } from "@/lib/store";
import { describeWhen } from "@/lib/send-schedule";
import { waitLabel } from "@/lib/thread-send-state";
import type { Message } from "@/lib/types";
import { Button } from "@/components/ui/button";

export function WaitingLine({ m }: { m: Message }) {
  const { cancelScheduled } = useApp();
  const [working, setWorking] = useState(false);
  const outboxId = m.id.replace(/^outbox:/, "");
  const cancel = async () => {
    setWorking(true);
    try { await cancelScheduled(outboxId, false); } finally { setWorking(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-1 px-3 text-xs text-muted-foreground">
      <span>{waitLabel(m.waitReason!)}{m.scheduledFor ? ` · Goes ${describeWhen(new Date(m.scheduledFor), new Date())}` : ""}</span>
      <Button variant="ghost" size="xs" disabled={working} onClick={cancel}>Cancel</Button>
    </div>
  );
}
