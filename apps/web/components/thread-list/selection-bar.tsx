"use client";

// The header bar that replaces the view and filter controls while conversations are checked: Select All, then the actions.

import { Archive, Mail, MailCheck, OctagonAlert, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RowButton } from "./row-button";
import type { RowAction } from "./use-row-actions";

/** Takes the place of the view and filter controls while rows are checked: Select All, then the actions. */
export function BulkBar({ allPicked, count, onAll, onClear, onDone, children }: { allPicked: boolean; /** How many are checked, said beside Select All (it takes every conversation in the filter, not only the rows drawn). */ count?: number; onAll: () => void; onClear: () => void; /** Leaves select mode; without it the X only unchecks. */ onDone?: () => void; children: React.ReactNode }) {
  return (
    <div className="flex h-8 items-center justify-between gap-3">
      {/* Once every row is checked, the same button clears them all. */}
      <div className="flex min-w-0 items-center gap-2">
        <Button variant="secondary" onClick={allPicked ? onClear : onAll}>{allPicked ? "Deselect All" : "Select All"}</Button>
        {!!count && <span className="truncate text-xs tabular-nums text-muted-foreground">{allPicked ? `All ${count} Selected` : `${count} Selected`}</span>}
      </div>
      <div className="flex items-center gap-1">
        {children}
        <RowButton label={onDone ? "Done Selecting" : "Clear Selection"} icon={X} onClick={onDone ?? onClear} />
      </div>
    </div>
  );
}

/** The header's actions on checked conversations. */
export function SelectionBar({ allPicked, count, anyUnread, onAll, onClear, onDone, onAction }: { allPicked: boolean; count?: number; anyUnread: boolean; onAll: () => void; onClear: () => void; onDone?: () => void; onAction: (action: RowAction) => void }) {
  return (
    <BulkBar allPicked={allPicked} count={count} onAll={onAll} onClear={onClear} onDone={onDone}>
      <RowButton label="Archive" icon={Archive} onClick={() => onAction("archive")} />
      <RowButton label="Delete" icon={Trash2} onClick={() => onAction("trash")} />
      <RowButton label="Move to Junk" icon={OctagonAlert} onClick={() => onAction("junk")} />
      {/* The read action marks them read if any is unread, otherwise unread, so the label follows. */}
      <RowButton label={anyUnread ? "Mark as Read" : "Mark as Unread"} icon={anyUnread ? MailCheck : Mail} onClick={() => onAction("read")} />
    </BulkBar>
  );
}
