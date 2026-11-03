"use client";

// Settings, Accounts, Sending: how long a message waits after Send so it can be undone. Kept in this browser; the
// window is added to the outbox row's send_after when the message is queued (lib/send-schedule.ts).

import { useEffect, useState } from "react";
import { DEFAULT_UNDO_SECONDS, UNDO_CHOICES, readUndoSeconds, writeUndoSeconds } from "@/lib/send-schedule";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsRow } from "@/components/settings/primitives";

/** The Undo Send row, for this device only. */
export function UndoSendRow() {
  // Read after mount: the stored value is not known on the server.
  const [seconds, setSeconds] = useState(DEFAULT_UNDO_SECONDS);
  useEffect(() => setSeconds(readUndoSeconds()), []);
  return (
    <SettingsRow title="Undo Send">
      <Select value={String(seconds)} onValueChange={(v) => { setSeconds(Number(v)); writeUndoSeconds(Number(v)); }}>
        <SelectTrigger className="w-32" aria-label="Undo Send"><SelectValue /></SelectTrigger>
        <SelectContent>{UNDO_CHOICES.map((s) => <SelectItem key={s} value={String(s)}>{s === 0 ? "Off" : `${s} Seconds`}</SelectItem>)}</SelectContent>
      </Select>
    </SettingsRow>
  );
}
