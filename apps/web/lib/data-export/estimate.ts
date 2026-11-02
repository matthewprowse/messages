// What Include Files will add to Download My Data, in words. Pure. The archive is built in the browser's memory, so a big
// one needs a warning: past LARGE_BYTES a phone or an older computer may run out before the download starts.

import { bytesLabel } from "../storage";

/** Where the warning starts. */
export const LARGE_BYTES = 1.5 * 1024 ** 3;

export interface UsageRow { kind: string; files: number; bytes: number }

/** Totals of the storage_usage rows (the same numbers as Settings, Storage; voice notes and stickers are not in them). */
export function totalUsage(rows: UsageRow[]): { files: number; bytes: number } {
  return rows.reduce((t, r) => ({ files: t.files + Number(r.files), bytes: t.bytes + Number(r.bytes) }), { files: 0, bytes: 0 });
}

/** The line under the Include Files switch. */
export function estimateText(total: { files: number; bytes: number } | null): string {
  if (!total) return "Add every photo, PDF and document you have saved.";
  if (total.files === 0) return "You have no saved files, so this adds nothing.";
  const base = `${total.files.toLocaleString("en-GB")} ${total.files === 1 ? "file" : "files"}, about ${bytesLabel(total.bytes)}.`;
  return total.bytes >= LARGE_BYTES ? `${base} That is a lot: use a computer, close other tabs, and keep this page open.` : base;
}
