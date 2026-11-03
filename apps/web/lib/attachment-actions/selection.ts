// Multi-select on the Attachments page as plain functions: toggling, what the toolbar offers for a selection, the
// Largest sort, and the words used. No React; the page keeps the Set in state.

import type { FiledAttachment } from "../types";

/** A new Set with the id added or taken out. */
export function toggled(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** The selected files that are still in view, in the order shown. A file that left the list (hidden, deleted) drops out. */
export function selectedFiles(items: FiledAttachment[], selected: ReadonlySet<string>): FiledAttachment[] {
  return items.filter((a) => selected.has(a.id));
}

export type SelectionActions = {
  /** Files with a stored copy, which a zip can hold. */
  downloadable: number;
  /** Files with no copy here (left at the mailbox, deleted), which Download Selected skips. */
  skipped: number;
  /** Hide Selected when any chosen file is showing, otherwise Unhide Selected. */
  hide: boolean;
  /** Files whose copy Konva holds, which Delete can remove. */
  deletable: number;
};

/** What the selection bar offers for these files. */
export function actionsFor(files: Pick<FiledAttachment, "path" | "hiddenReason">[]): SelectionActions {
  const stored = files.filter((f) => !!f.path).length;
  return { downloadable: stored, skipped: files.length - stored, hide: files.some((f) => !f.hiddenReason), deletable: stored };
}

/** "3 Selected", the bar's count. */
export const selectedLabel = (n: number) => `${n.toLocaleString()} Selected`;

/** The sort choices; Largest needs every file loaded to be right, so the page treats it like a filter. */
export type Sort = "newest" | "largest";
export const SORTS: { key: Sort; label: string }[] = [{ key: "newest", label: "Newest" }, { key: "largest", label: "Largest" }];

/** Biggest first, files of unknown size last, ties newest first so the order never shuffles. */
export function sortLargest<T extends Pick<FiledAttachment, "bytes" | "sentAt" | "id">>(files: T[]): T[] {
  return [...files].sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1) || b.sentAt.localeCompare(a.sentAt) || b.id.localeCompare(a.id));
}

