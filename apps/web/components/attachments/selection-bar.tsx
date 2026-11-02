"use client";

// The bar over the Attachments grid while selecting: how many files are picked, Select All, Download Selected (a zip),
// Hide Selected (or Unhide Selected), Delete and Done. The rules for what each button does are in
// lib/attachment-actions/selection.ts; the page does the work.

import { actionsFor, selectedLabel } from "@/lib/attachment-actions/selection";
import type { FiledAttachment } from "@/lib/types";
import { Button } from "@/components/ui/button";

export function SelectionBar({ files, total, busy, onSelectAll, onClear, onDownload, onHide, onDelete, onDone }: {
  /** The selected files. */
  files: FiledAttachment[];
  /** How many files are in view, so Select All can say it is already everything. */
  total: number;
  busy: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onDownload: () => void;
  onHide: () => void;
  onDelete: () => void;
  onDone: () => void;
}) {
  const a = actionsFor(files);
  const none = files.length === 0;
  return (
    <div role="toolbar" aria-label="Selected Files" className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-background p-3 md:px-4">
      <span className="mr-auto text-sm tabular-nums" aria-live="polite">{selectedLabel(files.length)}</span>
      {files.length < total ? <Button variant="ghost" onClick={onSelectAll}>Select All</Button> : <Button variant="ghost" onClick={onClear}>Select None</Button>}
      <Button variant="secondary" disabled={busy || a.downloadable === 0} onClick={onDownload}>Download Selected</Button>
      <Button variant="secondary" disabled={busy || none} onClick={onHide}>{a.hide ? "Hide Selected" : "Unhide Selected"}</Button>
      <Button variant="secondary" disabled={busy || a.deletable === 0} onClick={onDelete}>Delete</Button>
      <Button variant="secondary" disabled={busy} onClick={onDone}>Done</Button>
    </div>
  );
}
