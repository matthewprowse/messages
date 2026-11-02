// The Attachments library's paging as plain functions: one total order (sent time, then id, newest first), the keyset
// filter for the next page, merging pages without duplicates, and refreshing the top of a list that is already loaded.
// No network, so it is tested here (attachment-pages.test.ts); lib/data/load-attachments.ts and the hook call it.

import type { FiledAttachment } from "./types";

/** Files per request. Names are decrypted in the browser, so a page is kept small enough to open quickly. */
export const ATTACHMENT_PAGE = 200;

/** Where the next page starts: just after this file in the order. */
export type Cursor = { sentAt: string; id: string };

export const cursorOf = (a: Pick<FiledAttachment, "sentAt" | "id">): Cursor => ({ sentAt: a.sentAt, id: a.id });

/** Newest first; files sent at the same moment fall back to id, so the order is the same on every page and every visit. */
export function compareFiles(a: Pick<FiledAttachment, "sentAt" | "id">, b: Pick<FiledAttachment, "sentAt" | "id">): number {
  const x = Date.parse(a.sentAt);
  const y = Date.parse(b.sentAt);
  if (x !== y) return y - x;
  return a.id === b.id ? 0 : a.id < b.id ? 1 : -1;
}

/** The PostgREST `or` filter for "after this cursor" in (sent_at desc, id desc) order. Values are quoted for the filter syntax. */
export function afterCursorFilter(c: Cursor): string {
  const at = `"${c.sentAt}"`;
  return `sent_at.lt.${at},and(sent_at.eq.${at},id.lt.${c.id})`;
}

/** Existing and incoming files as one list in order, each file once; an incoming copy replaces an older one. */
export function mergePages(existing: FiledAttachment[], incoming: FiledAttachment[]): FiledAttachment[] {
  const byId = new Map<string, FiledAttachment>();
  for (const a of existing) byId.set(a.id, a);
  for (const a of incoming) byId.set(a.id, a);
  return [...byId.values()].sort(compareFiles);
}

/**
 * Brings a loaded list up to date from a fresh first page. When the page is the whole library (it came back short) the
 * list is replaced. Otherwise everything from the newest down to the page's last file is replaced by the page, which
 * drops files that were hidden or removed meanwhile, and everything older is kept as it was loaded.
 */
export function refreshHead(existing: FiledAttachment[], page: FiledAttachment[], pageSize = ATTACHMENT_PAGE): FiledAttachment[] {
  if (page.length < pageSize) return [...page].sort(compareFiles);
  const sorted = [...page].sort(compareFiles);
  const boundary = sorted[sorted.length - 1];
  const older = existing.filter((a) => compareFiles(a, boundary) > 0);
  return [...sorted, ...older];
}
