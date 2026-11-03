"use client";

// The bar that takes the views row's place on the Attachments page while selecting, built on Conversations' BulkBar: Select
// All with the count, then Download (a zip), Hide or Unhide, Delete and Done as icons. The rules for what each button does
// are in lib/attachment-actions/selection.ts; the page does the work.

import { Download, Eye, EyeOff, Trash2 } from "lucide-react";
import { actionsFor } from "@/lib/attachment-actions/selection";
import type { FiledAttachment } from "@/lib/types";
import { IconAction } from "@/components/tip";
import { BulkBar } from "@/components/thread-list/selection-bar";

export function SelectionBar({ files, total, busy, onSelectAll, onClear, onDownload, onHide, onDelete, onDone }: {
  /** The selected files. */
  files: FiledAttachment[];
  /** How many files are in view, so Select All can turn into Deselect All. */
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
    <BulkBar allPicked={total > 0 && files.length >= total} count={files.length} onAll={onSelectAll} onClear={onClear} onDone={onDone}>
      <IconAction label="Download" icon={Download} disabled={busy || a.downloadable === 0} onClick={onDownload} />
      <IconAction label={a.hide ? "Hide" : "Unhide"} icon={a.hide ? EyeOff : Eye} disabled={busy || none} onClick={onHide} />
      <IconAction label="Delete" icon={Trash2} disabled={busy || a.deletable === 0} onClick={onDelete} />
    </BulkBar>
  );
}
