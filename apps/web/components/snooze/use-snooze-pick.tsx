"use client";

// Opens the Snooze dialog for some conversations and carries out the choice. The list, the Summary and the open
// conversation's header each call this once and render `dialog`; menus call `snoozeAt` for a ready-made time and
// `request` to open the dialog itself.

import { useCallback, useState } from "react";
import { SnoozeDialog, type SnoozeRequest } from "./snooze-dialog";
import type { RowAction } from "@/components/thread-list/use-row-actions";

/** `run` is the selection's run (it also steps off the open conversation), or the store's snooze for a header. */
export function useSnoozePick(run: (ids: string[], action: RowAction, at?: Date) => void) {
  const [pending, setPending] = useState<SnoozeRequest | null>(null);
  const request = useCallback((ids: string[], mode: SnoozeRequest["mode"] = "snooze", step: SnoozeRequest["step"] = "choices") => {
    if (ids.length) setPending({ ids, mode, step });
  }, []);
  const snoozeAt = useCallback((ids: string[], at: Date, mode: SnoozeRequest["mode"] = "snooze") => run(ids, mode === "remind" ? "remind" : "snooze", at), [run]);
  const dialog = (
    <SnoozeDialog
      request={pending}
      onClose={() => setPending(null)}
      onPick={(r, at) => { setPending(null); snoozeAt(r.ids, at, r.mode); }}
    />
  );
  return { request, snoozeAt, dialog };
}
